// Output: Codex Chat Runtime provider backed by the Codex app-server protocol.
// Input: Chat Runtime turn requests, Codex profile config, and app-server notifications.
// Position: Runtime provider that streams Codex turns and supports true live steering.

import { randomUUID } from 'node:crypto'
import { unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { LangfuseGeneration } from '@langfuse/tracing'
import { startObservation } from '@langfuse/tracing'
import type { UIMessage, UIMessageChunk } from 'ai'
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
import { extractUiMessageText } from '../../ui-message-input'
import { WorkspaceProviderStateSnapshotJsonSchema } from '../provider-state-snapshot'
import type { CodexAppServerClientOptions, CodexAppServerMessage } from './app-server-client'
import { CodexAppServerClient } from './app-server-client'
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
  errorEvents: Array<Record<string, unknown>>
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

interface CodexProviderErrorData {
  details: null
  runtimeKind: RuntimeKind
  diagnostics: CodexStreamDiagnostics
  notification?: Record<string, unknown>
}

type RuntimeMessageInput = UIMessage | string
type MessagePart = UIMessage['parts'][number]
type CodexUserInput = { type: 'text', text: string, text_elements: [] }
  | { type: 'image', detail?: 'high' | 'original', url: string }
  | { type: 'localImage', detail?: 'high' | 'original', path: string }

const RUNTIME_KIND: RuntimeKind = 'codex'
const MAX_EVENT_SAMPLES = 20
const MAX_DIAGNOSTIC_STRING_LENGTH = 2_000
const MAX_DIAGNOSTIC_ARRAY_ITEMS = 20
const MAX_DIAGNOSTIC_OBJECT_KEYS = 40
const MAX_DIAGNOSTIC_DEPTH = 4
const LangfuseGenerationSpanSchema = z.object({
  otelSpan: z.object({
    setAttribute: z.function({
      input: [z.string(), z.string()],
      output: z.void(),
    }),
  }),
}).passthrough()

class CodexProviderError extends Error {
  readonly code: string
  readonly data: CodexProviderErrorData

  constructor(code: string, message: string, data: CodexProviderErrorData) {
    super(message)
    this.name = 'CodexProviderError'
    this.code = code
    this.data = data
  }
}

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
      providerTargetId: input.profile.providerTargetId,
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
    const userInput = projectCodexUserInput(input.message, 'Codex provider')
    const userPromptText = extractUiMessageText(input.message).trim()
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
          ? [{ role: 'system', content: input.systemPrompt }, { role: 'user', content: describeCodexUserInput(userInput, userPromptText) }]
          : [{ role: 'user', content: describeCodexUserInput(userInput, userPromptText) }],
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
        input: userInput,
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
            throw createCodexTurnFailureError(turn.error?.message, diagnostics, notification)
          }
          break
        }
        if (notification.method === 'error') {
          throw createCodexAppServerError(notification, diagnostics)
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
        throw createCodexEmptyStreamError(errorText, diagnostics)
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
    const userInput = projectCodexUserInput(input.message, 'Codex provider live steer')
    await entry.client.request('turn/steer', {
      threadId: entry.threadId,
      expectedTurnId: entry.turnId,
      input: userInput,
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

function projectCodexUserInput(message: RuntimeMessageInput, runtimeLabel: string): CodexUserInput[] {
  if (typeof message === 'string') {
    const text = message.trim()
    if (!text) {
      throw new Error(`${runtimeLabel} requires non-empty text or image input`)
    }
    return [toTextUserInput(text)]
  }

  const input: CodexUserInput[] = []
  const unsupportedParts: string[] = []
  for (const part of message.parts) {
    if (part.type === 'text') {
      const text = part.text.trim()
      if (text) {
        input.push(toTextUserInput(text))
      }
      continue
    }
    if (part.type === 'file') {
      if (part.mediaType.startsWith('image/')) {
        input.push(toCodexImageInput(part))
      }
      else {
        unsupportedParts.push(describeUnsupportedFilePart(part))
      }
      continue
    }
    unsupportedParts.push(part.type)
  }

  if (unsupportedParts.length > 0) {
    throw new Error(`${runtimeLabel} only supports text and image input; unsupported parts: ${unsupportedParts.join(', ')}`)
  }
  if (input.length === 0) {
    throw new Error(`${runtimeLabel} requires non-empty text or image input`)
  }
  return input
}

function toTextUserInput(text: string): CodexUserInput {
  return { type: 'text', text, text_elements: [] }
}

function toCodexImageInput(part: Extract<MessagePart, { type: 'file' }>): CodexUserInput {
  if (part.url.startsWith('file:')) {
    return { type: 'localImage', path: fileURLToPath(part.url) }
  }
  return { type: 'image', url: part.url }
}

function describeUnsupportedFilePart(part: Extract<MessagePart, { type: 'file' }>): string {
  const filename = part.filename ? ` (${part.filename})` : ''
  return `file${filename} (${part.mediaType})`
}

function describeCodexUserInput(input: CodexUserInput[], text: string): string {
  const imageCount = input.filter(item => item.type === 'image' || item.type === 'localImage').length
  if (imageCount === 0) {
    return text
  }
  const suffix = `[${imageCount} image${imageCount === 1 ? '' : 's'}]`
  return text ? `${text}\n${suffix}` : suffix
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
    errorEvents: [],
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
  if (notification.method === 'error' && diagnostics.errorEvents.length < MAX_EVENT_SAMPLES) {
    diagnostics.errorEvents.push(buildDiagnosticNotification(notification))
  }
}

function buildSampleEvent(notification: CodexAppServerMessage): Record<string, unknown> {
  const item = (notification.params as ItemNotificationParams | undefined)?.item
  const base = buildDiagnosticNotification(notification)
  if (!item) {
    return base
  }
  return { ...base, itemType: item.type, itemId: item.id }
}

function buildDiagnosticNotification(notification: CodexAppServerMessage): Record<string, unknown> {
  const sample: Record<string, unknown> = {
    method: notification.method,
  }
  if (notification.error) {
    sample.error = sanitizeDiagnosticValue(notification.error)
  }
  if (notification.params !== undefined) {
    sample.params = sanitizeDiagnosticValue(notification.params)
  }
  if (notification.result !== undefined) {
    sample.result = sanitizeDiagnosticValue(notification.result)
  }
  return sample
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

function createCodexTurnFailureError(
  message: string | undefined,
  diagnostics: CodexStreamDiagnostics,
  notification: CodexAppServerMessage,
): CodexProviderError {
  const errorText = `Codex turn failed${message ? `: ${message}` : ''} (raw=${formatCodexDiagnostics(diagnostics)})`
  return createCodexProviderError(errorText, diagnostics, notification)
}

function createCodexAppServerError(notification: CodexAppServerMessage, diagnostics: CodexStreamDiagnostics): CodexProviderError {
  const message = (notification.params as { message?: string } | undefined)?.message ?? 'Codex app-server error'
  const errorText = `${message} (raw=${formatCodexDiagnostics(diagnostics)})`
  return createCodexProviderError(errorText, diagnostics, notification)
}

function createCodexEmptyStreamError(errorText: string, diagnostics: CodexStreamDiagnostics): CodexProviderError {
  return createCodexProviderError(errorText, diagnostics)
}

function createCodexProviderError(
  message: string,
  diagnostics: CodexStreamDiagnostics,
  notification?: CodexAppServerMessage,
): CodexProviderError {
  return new CodexProviderError(OBSERVABILITY_CODES.turnStreamFailed, message, {
    details: null,
    runtimeKind: RUNTIME_KIND,
    diagnostics,
    ...(notification ? { notification: buildDiagnosticNotification(notification) } : {}),
  })
}

function formatCodexDiagnostics(diagnostics: CodexStreamDiagnostics): string {
  const eventTypes = formatCounts(diagnostics.eventTypeCounts)
  const itemTypes = formatCounts(diagnostics.itemTypeCounts)
  const samples = diagnostics.sampleEvents.length > 0
    ? `, samples=${formatDiagnosticValue(diagnostics.sampleEvents)}`
    : ''
  const errors = diagnostics.errorEvents.length > 0
    ? `, errors=${formatDiagnosticValue(diagnostics.errorEvents)}`
    : ''
  return `events_total=${diagnostics.totalEvents}, mapped_events=${diagnostics.mappedEvents}, event_types=${eventTypes}, item_types=${itemTypes}${samples}${errors}`
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))
  if (entries.length === 0) {
    return '-'
  }
  return entries.map(([key, count]) => `${key}:${count}`).join(',')
}

function formatDiagnosticValue(value: unknown): string {
  const text = JSON.stringify(sanitizeDiagnosticValue(value))
  if (text.length <= MAX_DIAGNOSTIC_STRING_LENGTH) {
    return text
  }
  return `${text.slice(0, MAX_DIAGNOSTIC_STRING_LENGTH)}...<truncated>`
}

function sanitizeDiagnosticValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value
  }
  if (typeof value === 'string') {
    return value.length <= MAX_DIAGNOSTIC_STRING_LENGTH
      ? value
      : `${value.slice(0, MAX_DIAGNOSTIC_STRING_LENGTH)}...<truncated>`
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'bigint') {
    return value.toString()
  }
  if (typeof value !== 'object') {
    return String(value)
  }
  if (depth >= MAX_DIAGNOSTIC_DEPTH) {
    return '[MaxDepth]'
  }
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_DIAGNOSTIC_ARRAY_ITEMS)
      .map(item => sanitizeDiagnosticValue(item, depth + 1))
    if (value.length > MAX_DIAGNOSTIC_ARRAY_ITEMS) {
      items.push(`[${value.length - MAX_DIAGNOSTIC_ARRAY_ITEMS} more items]`)
    }
    return items
  }

  const output: Record<string, unknown> = {}
  const entries = Object.entries(value as Record<string, unknown>)
  for (const [key, item] of entries.slice(0, MAX_DIAGNOSTIC_OBJECT_KEYS)) {
    output[key] = sanitizeDiagnosticValue(item, depth + 1)
  }
  if (entries.length > MAX_DIAGNOSTIC_OBJECT_KEYS) {
    output.__truncatedKeys = entries.length - MAX_DIAGNOSTIC_OBJECT_KEYS
  }
  return output
}
