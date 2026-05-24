// Output: Codex Chat Runtime provider backed by the Codex app-server protocol.
// Input: Chat Runtime turn requests, Codex profile config, and app-server notifications.
// Position: Runtime provider that streams Codex turns and supports true live steering.

import { randomUUID } from 'node:crypto'
import { unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { LangfuseGeneration } from '@langfuse/tracing'
import { startObservation } from '@langfuse/tracing'
import type { UIMessageChunk } from 'ai'
import { z } from 'zod'

import { langfuseEnabled } from '../../../../langfuse'
import { getRegisteredMcpServers } from '../../../../plugins'
import type { CreateEventInput } from '../../../observability/contract'
import { createDedupeKey, OBSERVABILITY_CODES } from '../../../observability/contract'
import type { CodexConfig } from '../../../providers/provider-base'
import { CodexConfigJsonSchema, resolveApiKey } from '../../../providers/provider-base'
import type { RuntimeKind } from '../../../providers/types'
import type { TokenUsage } from '../../engine/ai-sdk-engine'
import type {
  CancelTurnInput,
  ChatRuntime,
  ResumeChatSessionInput,
  RuntimeSession,
  StartChatSessionInput,
  SteerTurnInput,
  StreamTurnInput,
} from '../../runtime-provider-types'
import { projectTextOnlyInput } from '../../ui-message-input'
import { WorkspaceProviderStateSnapshotJsonSchema } from '../provider-state-snapshot'
import { CodexAppServerClient, type CodexAppServerClientOptions, type CodexAppServerMessage } from './app-server-client'
import {
  closeOpenCodexAppServerReasoning,
  closeOpenCodexAppServerText,
  createCodexAppServerMapperState,
  mapCodexAppServerNotificationToChunks,
} from './app-server-mapper'

interface CodexProviderDeps {
  readSecret: (credentialRef: string) => string
  resolveSkillPaths: (workspacePath: string) => string[]
  recordObservability: (input: CreateEventInput) => void
  createAppServerClient?: (options: CodexAppServerClientOptions) => CodexAppServerClientLike
}

interface CodexAppServerClientLike {
  initialize: () => Promise<void>
  request: (method: string, params?: unknown) => Promise<unknown>
  nextNotification: (signal?: AbortSignal) => Promise<CodexAppServerMessage | null>
  close: () => void
}

interface ActiveCodexTurn {
  client: CodexAppServerClientLike
  abortController: AbortController
  threadId: string
  turnId: string | null
}

interface CodexStreamDiagnostics {
  totalEvents: number
  mappedEvents: number
  eventTypeCounts: Record<string, number>
  itemTypeCounts: Record<string, number>
  sampleEvents: Array<Record<string, unknown>>
}

interface ThreadResponse {
  thread?: { id?: string }
}

interface TurnResponse {
  turn?: { id?: string, status?: string, error?: { message?: string } | null }
  turnId?: string
}

interface TurnNotificationParams {
  threadId?: string
  turn?: { id?: string, status?: string, error?: { message?: string } | null }
}

interface ItemNotificationParams {
  item?: { type?: string, id?: string }
}

const RUNTIME_KIND: RuntimeKind = 'codex'
const MAX_EVENT_SAMPLES = 20
const LangfuseGenerationSpanSchema = z.object({
  otelSpan: z.object({
    setAttribute: z.function({
      input: [z.string(), z.string()],
      output: z.void(),
    }),
  }),
}).passthrough()

export class CodexProvider implements ChatRuntime {
  readonly runtimeKind = RUNTIME_KIND

  private readonly activeTurns = new Map<string, ActiveCodexTurn>()
  private _lastUsage: TokenUsage | null = null

  get lastUsage(): TokenUsage | null {
    return this._lastUsage
  }

  constructor(private readonly deps: CodexProviderDeps) {}

  private releaseTurn(sessionId: string, entry: ActiveCodexTurn): void {
    if (this.activeTurns.get(sessionId) === entry) {
      this.activeTurns.delete(sessionId)
    }
  }

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      agentProfileId: input.profile.id,
      runtimeKind: RUNTIME_KIND,
      providerSessionId: null,
      providerStateSnapshot: JSON.stringify({ workspacePath: input.workspacePath, models: { currentModelId: input.modelId } }),
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    const snapshot = WorkspaceProviderStateSnapshotJsonSchema.parse(input.runtimeSession.providerStateSnapshot)
    return {
      ...input.runtimeSession,
      providerStateSnapshot: JSON.stringify({
        ...snapshot,
        workspacePath: input.workspacePath,
        models: {
          currentModelId: input.modelId ?? snapshot.models.currentModelId,
        },
      }),
    }
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    const config = CodexConfigJsonSchema.parse(input.profile.configJson)
    const apiKey = resolveApiKey(input.profile, config.apiKey, 'OPENAI_API_KEY', this.deps)
    const effectiveModel = input.modelId ?? config.model
    const userPrompt = projectTextOnlyInput(input.message, 'Codex provider')
    if (!apiKey) {
      throw new Error('Codex provider requires an API key')
    }

    const snapshot = WorkspaceProviderStateSnapshotJsonSchema.parse(input.runtimeSession.providerStateSnapshot)
    const workspacePath = snapshot.workspacePath ?? '.'
    const systemPromptFile = writeSystemPromptFile(input.systemPrompt)
    const codexConfig = buildCodexConfig(config, workspacePath, this.deps.resolveSkillPaths, systemPromptFile)
    const client = this.createAppServerClient({ apiKey, baseUrl: config.baseUrl, config: codexConfig })
    const abortController = new AbortController()
    const sessionId = input.runtimeSession.chatSessionId
    this._lastUsage = null

    const textItemId = randomUUID()
    const mapperState = createCodexAppServerMapperState(textItemId)
    const diagnostics = createDiagnostics()
    let activeEntry: ActiveCodexTurn | null = null

    let generation: LangfuseGeneration | null = null
    if (langfuseEnabled) {
      generation = startObservation('codex-generation', {
        model: effectiveModel ?? 'codex',
        input: input.systemPrompt
          ? [{ role: 'system', content: input.systemPrompt }, { role: 'user', content: userPrompt }]
          : [{ role: 'user', content: userPrompt }],
      }, { asType: 'generation' }) as LangfuseGeneration
      const span = LangfuseGenerationSpanSchema.parse(generation).otelSpan
      span.setAttribute('langfuse.session.id', input.runtimeSession.chatSessionId)
      span.setAttribute('langfuse.trace.name', 'codex-chat')
    }
    let outputTextCollector = ''

    try {
      await client.initialize()
      const threadId = await startOrResumeThread(client, input.runtimeSession, {
        model: effectiveModel,
        cwd: workspacePath,
        approvalPolicy: config.approvalPolicy,
        sandbox: config.sandboxMode,
        config: codexConfig,
      })
      input.runtimeSession.providerSessionId = threadId

      const turnResponse = await client.request('turn/start', {
        threadId,
        input: [toTextUserInput(userPrompt)],
        cwd: workspacePath,
        approvalPolicy: config.approvalPolicy,
        sandboxPolicy: toSandboxPolicy(config.sandboxMode, workspacePath, config.additionalDirectories),
        model: effectiveModel,
        effort: config.reasoningEffort,
      }) as TurnResponse
      const turnId = turnResponse.turn?.id ?? turnResponse.turnId ?? null
      activeEntry = { client, abortController, threadId, turnId }
      this.activeTurns.set(sessionId, activeEntry)

      for await (const notification of readTurnNotifications(client, threadId, turnId, abortController.signal)) {
        if (abortController.signal.aborted) {
          break
        }
        collectCodexStreamDiagnostics(diagnostics, notification)
        const chunks = mapCodexAppServerNotificationToChunks(notification, mapperState)
        diagnostics.mappedEvents += chunks.length
        for (const chunk of chunks) {
          if (generation && chunk.type === 'text-delta' && 'delta' in chunk) {
            outputTextCollector += (chunk as { delta: string }).delta
          }
          yield chunk
        }

        if (notification.method === 'turn/started' && !activeEntry.turnId) {
          activeEntry.turnId = getTurnId(notification)
        }
        if (notification.method === 'turn/completed') {
          const turn = (notification.params as TurnNotificationParams | undefined)?.turn
          if (turn?.status === 'failed') {
            throw new Error(formatCodexTurnFailure(turn.error?.message, diagnostics))
          }
          break
        }
        if (notification.method === 'error') {
          throw new Error(formatCodexAppServerError(notification, diagnostics))
        }
      }

      for (const chunk of closeOpenCodexAppServerReasoning(mapperState)) {
        diagnostics.mappedEvents += 1
        yield chunk
      }
      for (const chunk of closeOpenCodexAppServerText(mapperState)) {
        diagnostics.mappedEvents += 1
        yield chunk
      }

      const validation = validateCodexStreamOutput(diagnostics)
      if (!validation.ok) {
        const errorText = validation.errorText ?? 'Codex app-server stream produced no timeline output events'
        this.deps.recordObservability({
          source: 'provider',
          code: OBSERVABILITY_CODES.providerEmptyEventStream,
          severity: 'error',
          category: 'provider',
          message: errorText,
          chatSessionId: input.runtimeSession.chatSessionId,
          dedupeKey: createDedupeKey({
            code: OBSERVABILITY_CODES.providerEmptyEventStream,
            chatSessionId: input.runtimeSession.chatSessionId,
            runId: null,
          }),
          attrs: { runtimeKind: RUNTIME_KIND, diagnostics, model: effectiveModel, baseUrl: config.baseUrl },
        })
        throw new Error(errorText)
      }

      if (generation) {
        const update: Parameters<LangfuseGeneration['update']>[0] = {
          output: outputTextCollector || undefined,
        }
        generation.update(update)
      }
      generation?.end()
    }
    catch (error) {
      if (generation) {
        generation.update({
          level: 'ERROR',
          statusMessage: error instanceof Error ? error.message : String(error),
        })
        generation.end()
      }
      throw error
    }
    finally {
      if (activeEntry) {
        this.releaseTurn(sessionId, activeEntry)
      }
      client.close()
      if (systemPromptFile) {
        try {
          unlinkSync(systemPromptFile)
        }
        catch { /* ignore */ }
      }
    }
  }

  async steerTurn(input: SteerTurnInput): Promise<void> {
    const entry = this.activeTurns.get(input.runtimeSession.chatSessionId)
    if (!entry?.turnId) {
      throw new Error('Codex live steer requires an active turn')
    }
    const text = projectTextOnlyInput(input.message, 'Codex provider live steer')
    await entry.client.request('turn/steer', {
      threadId: entry.threadId,
      expectedTurnId: entry.turnId,
      input: [toTextUserInput(text)],
    })
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const sessionId = input.runtimeSession.chatSessionId
    const entry = this.activeTurns.get(sessionId)
    if (!entry) {
      return
    }
    entry.abortController.abort()
    if (entry.turnId) {
      await entry.client.request('turn/interrupt', {
        threadId: entry.threadId,
        turnId: entry.turnId,
      }).catch(() => undefined)
    }
    this.releaseTurn(sessionId, entry)
    entry.client.close()
  }

  private createAppServerClient(options: CodexAppServerClientOptions): CodexAppServerClientLike {
    return this.deps.createAppServerClient?.(options) ?? new CodexAppServerClient(options)
  }
}

async function startOrResumeThread(
  client: CodexAppServerClientLike,
  runtimeSession: RuntimeSession,
  params: {
    model?: string | null
    cwd: string
    approvalPolicy: CodexConfig['approvalPolicy']
    sandbox: CodexConfig['sandboxMode']
    config: Record<string, unknown>
  },
): Promise<string> {
  const baseParams = {
    model: params.model,
    cwd: params.cwd,
    approvalPolicy: params.approvalPolicy,
    sandbox: params.sandbox,
    config: params.config,
  }
  const response = await client.request(
    runtimeSession.providerSessionId ? 'thread/resume' : 'thread/start',
    runtimeSession.providerSessionId
      ? { ...baseParams, threadId: runtimeSession.providerSessionId, excludeTurns: true }
      : baseParams,
  ) as ThreadResponse
  const threadId = response.thread?.id
  if (!threadId) {
    throw new Error('Codex app-server did not return a thread id')
  }
  return threadId
}

async function* readTurnNotifications(
  client: CodexAppServerClientLike,
  threadId: string,
  initialTurnId: string | null,
  signal: AbortSignal,
): AsyncGenerator<CodexAppServerMessage, void, void> {
  let turnId = initialTurnId
  while (!signal.aborted) {
    let notification: CodexAppServerMessage | null
    try {
      notification = await client.nextNotification(signal)
    }
    catch (error) {
      if (signal.aborted) {
        return
      }
      throw error
    }
    if (!notification) {
      return
    }
    const notificationThreadId = getThreadId(notification)
    if (notificationThreadId && notificationThreadId !== threadId) {
      continue
    }
    if (notification.method === 'turn/started') {
      turnId = getTurnId(notification)
      yield notification
      continue
    }
    const notificationTurnId = getNotificationTurnId(notification)
    if (turnId && notificationTurnId && notificationTurnId !== turnId) {
      continue
    }
    yield notification
    if (notification.method === 'turn/completed') {
      return
    }
  }
}

function buildCodexConfig(
  config: CodexConfig,
  workspacePath: string,
  resolveSkillPaths: (workspacePath: string) => string[],
  systemPromptFile: string | null,
): Record<string, unknown> {
  const skillPaths = config.skillPaths.length > 0
    ? config.skillPaths
    : resolveSkillPaths(workspacePath)
  const instructionPaths = [...skillPaths, ...(systemPromptFile ? [systemPromptFile] : [])]
  const codexConfig: Record<string, unknown> = {}
  const mcpServers = buildCodexMcpServersConfig()
  if (Object.keys(mcpServers).length > 0) {
    codexConfig.mcp_servers = mcpServers
  }
  if (instructionPaths.length > 0) {
    codexConfig.instructions_paths = instructionPaths
  }
  return codexConfig
}

function buildCodexMcpServersConfig(): Record<string, { command: string, args: string[], env?: Record<string, string> }> {
  return Object.fromEntries(
    Object.entries(getRegisteredMcpServers()).map(([name, config]) => {
      const server: { command: string, args: string[], env?: Record<string, string> } = {
        command: config.command,
        args: config.args,
      }
      if (config.env && Object.keys(config.env).length > 0) {
        server.env = config.env
      }
      return [name, server]
    }),
  )
}

function writeSystemPromptFile(systemPrompt: string | undefined): string | null {
  if (!systemPrompt) {
    return null
  }
  const filePath = join(tmpdir(), `cradle-codex-prompt-${randomUUID()}.md`)
  writeFileSync(filePath, systemPrompt, 'utf-8')
  return filePath
}

function toTextUserInput(text: string): { type: 'text', text: string, text_elements: [] } {
  return { type: 'text', text, text_elements: [] }
}

function toSandboxPolicy(
  sandboxMode: CodexConfig['sandboxMode'],
  workspacePath: string,
  additionalDirectories: string[],
): unknown {
  if (sandboxMode === 'danger-full-access') {
    return { type: 'dangerFullAccess' }
  }
  if (sandboxMode === 'read-only') {
    return { type: 'readOnly', networkAccess: false }
  }
  return {
    type: 'workspaceWrite',
    writableRoots: [workspacePath, ...additionalDirectories],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  }
}

function createDiagnostics(): CodexStreamDiagnostics {
  return {
    totalEvents: 0,
    mappedEvents: 0,
    eventTypeCounts: {},
    itemTypeCounts: {},
    sampleEvents: [],
  }
}

function collectCodexStreamDiagnostics(diagnostics: CodexStreamDiagnostics, notification: CodexAppServerMessage): void {
  const method = notification.method ?? 'response'
  diagnostics.totalEvents += 1
  incrementCount(diagnostics.eventTypeCounts, method)
  const itemType = (notification.params as ItemNotificationParams | undefined)?.item?.type
  if (itemType) {
    incrementCount(diagnostics.itemTypeCounts, itemType)
  }
  if (diagnostics.sampleEvents.length < MAX_EVENT_SAMPLES) {
    diagnostics.sampleEvents.push(buildSampleEvent(notification))
  }
}

function buildSampleEvent(notification: CodexAppServerMessage): Record<string, unknown> {
  const item = (notification.params as ItemNotificationParams | undefined)?.item
  if (!item) {
    return { method: notification.method }
  }
  return { method: notification.method, itemType: item.type, itemId: item.id }
}

function getThreadId(notification: CodexAppServerMessage): string | null {
  return (notification.params as { threadId?: string } | undefined)?.threadId ?? null
}

function getTurnId(notification: CodexAppServerMessage): string | null {
  return (notification.params as TurnNotificationParams | undefined)?.turn?.id ?? null
}

function getNotificationTurnId(notification: CodexAppServerMessage): string | null {
  return (notification.params as { turnId?: string } | undefined)?.turnId ?? getTurnId(notification)
}

function incrementCount(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1
}

function validateCodexStreamOutput(diagnostics: CodexStreamDiagnostics): { ok: boolean, errorText: string | null } {
  if (diagnostics.mappedEvents > 0) {
    return { ok: true, errorText: null }
  }
  return {
    ok: false,
    errorText: `Codex app-server stream completed without mapped timeline events. ${formatCodexDiagnostics(diagnostics)}`,
  }
}

function formatCodexTurnFailure(message: string | undefined, diagnostics: CodexStreamDiagnostics): string {
  return `Codex turn failed${message ? `: ${message}` : ''} (raw=${formatCodexDiagnostics(diagnostics)})`
}

function formatCodexAppServerError(notification: CodexAppServerMessage, diagnostics: CodexStreamDiagnostics): string {
  const message = (notification.params as { message?: string } | undefined)?.message ?? 'Codex app-server error'
  return `${message} (raw=${formatCodexDiagnostics(diagnostics)})`
}

function formatCodexDiagnostics(diagnostics: CodexStreamDiagnostics): string {
  return `events_total=${diagnostics.totalEvents}, mapped_events=${diagnostics.mappedEvents}`
}
