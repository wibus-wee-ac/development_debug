// Input: Codex SDK, provider config helpers, and observability service
// Output: codex chat runtime provider for unified server chat execution
// Position: apps/server/src/modules/chat-runtime/providers/codex/provider.ts

import { randomUUID } from 'node:crypto'
import { unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { LangfuseGeneration } from '@langfuse/tracing'
import { startObservation } from '@langfuse/tracing'
import type { Thread, ThreadEvent } from '@openai/codex-sdk'
import { Codex } from '@openai/codex-sdk'
import type { UIMessageChunk } from 'ai'

import { langfuseEnabled } from '../../../../langfuse'
import type { CreateEventInput } from '../../../observability/contract'
import { createDedupeKey, OBSERVABILITY_CODES } from '../../../observability/contract'
import { CodexConfigSchema, parseConfigWith, resolveApiKey } from '../../../providers/provider-base'
import type { RuntimeKind } from '../../../providers/types'
import type { TokenUsage } from '../../engine/ai-sdk-engine'
import type {
  CancelTurnInput,
  ChatRuntime,
  ResumeChatSessionInput,
  RuntimeSession,
  StartChatSessionInput,
  StreamTurnInput,
} from '../../runtime-provider-types'
import type { CodexChunkMapperState } from './mapper'
import { closeOpenCodexReasoning, mapCodexThreadEventToChunks } from './mapper'

interface CodexProviderDeps {
  readSecret: (credentialRef: string) => string
  resolveSkillPaths?: (workspacePath: string) => string[]
  recordObservability: (input: CreateEventInput) => void
}

const RUNTIME_KIND: RuntimeKind = 'codex'
const MAX_EVENT_SAMPLES = 20

interface CodexStreamDiagnostics {
  totalEvents: number
  mappedEvents: number
  eventTypeCounts: Record<string, number>
  itemTypeCounts: Record<string, number>
  sampleEvents: Array<Record<string, unknown>>
}

export class CodexProvider implements ChatRuntime {
  readonly runtimeKind = RUNTIME_KIND

  private readonly activeThreads = new Map<string, { thread: Thread, abortController: AbortController }>()
  private _lastUsage: TokenUsage | null = null

  get lastUsage(): TokenUsage | null {
    return this._lastUsage
  }

  constructor(private readonly deps: CodexProviderDeps) {}

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      agentProfileId: input.profile.id,
      runtimeKind: RUNTIME_KIND,
      providerSessionId: null,
      providerStateSnapshot: JSON.stringify({ workspacePath: input.workspacePath, models: { currentModelId: input.modelId ?? null } }),
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    const snapshot = parseProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    return {
      ...input.runtimeSession,
      providerStateSnapshot: JSON.stringify({
        ...snapshot,
        workspacePath: input.workspacePath,
        models: {
          currentModelId: input.modelId ?? snapshot.models?.currentModelId ?? null,
        },
      }),
    }
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    const config = parseConfigWith(input.profile.configJson, CodexConfigSchema)
    const apiKey = resolveApiKey(input.profile, config.apiKey, 'OPENAI_API_KEY', this.deps)
    const effectiveModel = input.modelId ?? config.model
    if (!apiKey) {
      throw new Error('Codex provider requires an API key')
    }

    const abortController = new AbortController()
    const snapshot = parseProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const workspacePath = snapshot.workspacePath ?? '.'
    const skillPaths = config.skillPaths ?? this.deps.resolveSkillPaths?.(workspacePath) ?? []
    const codexConfig: Record<string, string | string[]> = {}
    if (skillPaths.length > 0) {
      codexConfig.instructions_paths = skillPaths
    }

    // Inject system prompt via a temp instructions file
    let systemPromptFile: string | null = null
    if (input.systemPrompt) {
      systemPromptFile = join(tmpdir(), `cradle-codex-prompt-${randomUUID()}.md`)
      writeFileSync(systemPromptFile, input.systemPrompt, 'utf-8')
      const paths = (codexConfig.instructions_paths as string[] | undefined) ?? []
      paths.push(systemPromptFile)
      codexConfig.instructions_paths = paths
    }

    const codex = new Codex({
      apiKey,
      baseUrl: config.baseUrl,
      config: Object.keys(codexConfig).length > 0 ? codexConfig : undefined,
    })

    const threadOptions = {
      model: effectiveModel,
      workingDirectory: workspacePath,
      sandboxMode: config.sandboxMode ?? 'workspace-write',
      approvalPolicy: config.approvalPolicy ?? 'on-failure',
      modelReasoningEffort: config.reasoningEffort ?? 'high',
      additionalDirectories: config.additionalDirectories,
    }

    const thread = input.runtimeSession.providerSessionId
      ? codex.resumeThread(input.runtimeSession.providerSessionId, threadOptions)
      : codex.startThread(threadOptions)

    this.activeThreads.set(input.runtimeSession.chatSessionId, { thread, abortController })
    this._lastUsage = null

    const textItemId = randomUUID()
    const mapperState: CodexChunkMapperState = { textItemId, assistantStarted: false, openReasoningItemId: null }
    const diagnostics: CodexStreamDiagnostics = {
      totalEvents: 0,
      mappedEvents: 0,
      eventTypeCounts: {},
      itemTypeCounts: {},
      sampleEvents: [],
    }
    let threadId: string | null = null

    // Langfuse tracing via @langfuse/tracing SDK
    let generation: LangfuseGeneration | null = null
    if (langfuseEnabled) {
      generation = startObservation('codex-generation', {
        model: effectiveModel ?? 'codex',
        input: input.systemPrompt
          ? [{ role: 'system', content: input.systemPrompt }, { role: 'user', content: input.message }]
          : [{ role: 'user', content: input.message }],
      }, { asType: 'generation' }) as LangfuseGeneration
      const span = (generation as unknown as { otelSpan: { setAttribute: (k: string, v: string) => void } }).otelSpan
      span.setAttribute('langfuse.session.id', input.runtimeSession.chatSessionId)
      span.setAttribute('langfuse.trace.name', 'codex-chat')
    }
    let outputTextCollector = ''

    try {
      const { events } = await thread.runStreamed(input.message, { signal: abortController.signal })
      for await (const event of events) {
        if (abortController.signal.aborted) {
          break
        }

        collectCodexStreamDiagnostics(diagnostics, event)

        for (const syntheticChunk of closeOpenCodexReasoning(event, mapperState)) {
          diagnostics.mappedEvents += 1
          yield syntheticChunk
        }

        if (event.type === 'turn.failed') {
          throw new Error(formatCodexThreadFailure(event, diagnostics))
        }
        if (event.type === 'error') {
          throw new Error(formatCodexThreadFailure(event, diagnostics))
        }

        const result = mapCodexThreadEventToChunks(event, mapperState)
        if (event.type === 'item.started' && event.item.type === 'reasoning') {
          mapperState.openReasoningItemId = event.item.id
        }
        else if (event.type === 'item.completed' && event.item.type === 'reasoning') {
          mapperState.openReasoningItemId = null
        }
        mapperState.assistantStarted = result.assistantStarted
        diagnostics.mappedEvents += result.chunks.length
        for (const chunk of result.chunks) {
          if (generation && chunk.type === 'text-delta' && 'delta' in chunk) {
            outputTextCollector += (chunk as { delta: string }).delta
          }
          yield chunk
        }

        if (event.type === 'thread.started') {
          threadId = event.thread_id
        }
        if (event.type === 'turn.completed') {
          this._lastUsage = {
            promptTokens: event.usage.input_tokens,
            completionTokens: event.usage.output_tokens,
            totalTokens: event.usage.input_tokens + event.usage.output_tokens,
          }
        }
      }

      for (const syntheticChunk of closeOpenCodexReasoning({ type: 'turn.completed', usage: { input_tokens: 0, output_tokens: 0 } } as ThreadEvent, mapperState)) {
        diagnostics.mappedEvents += 1
        yield syntheticChunk
      }

      if (threadId) {
        input.runtimeSession.providerSessionId = threadId
      }

      const validation = validateCodexStreamOutput(diagnostics)
      if (!validation.ok) {
        const errorText = validation.errorText ?? 'Codex stream produced no timeline output events'
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
          attrs: { runtimeKind: RUNTIME_KIND, diagnostics, model: effectiveModel ?? null, baseUrl: config.baseUrl ?? null },
        })
        throw new Error(errorText)
      }

      if (mapperState.assistantStarted) {
        yield { type: 'text-end', id: textItemId }
      }

      // Record usage and output in the generation
      if (generation) {
        generation.update({
          output: outputTextCollector || undefined,
          ...(this._lastUsage && {
            usageDetails: {
              input: this._lastUsage.promptTokens,
              output: this._lastUsage.completionTokens,
              total: this._lastUsage.totalTokens,
            },
          }),
        })
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
      this.activeThreads.delete(input.runtimeSession.chatSessionId)
      // Clean up temp system prompt file
      if (systemPromptFile) {
        try {
          unlinkSync(systemPromptFile)
        }
        catch { /* ignore */ }
      }
    }
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const entry = this.activeThreads.get(input.runtimeSession.chatSessionId)
    if (!entry) {
      return
    }
    entry.abortController.abort()
    this.activeThreads.delete(input.runtimeSession.chatSessionId)
  }
}

function parseProviderStateSnapshot(providerStateSnapshot: string | null): {
  workspacePath?: string
  models?: { currentModelId?: string | null }
} {
  if (!providerStateSnapshot) {
    return {}
  }
  try {
    const parsed = JSON.parse(providerStateSnapshot) as {
      workspacePath?: string
      models?: { currentModelId?: string | null }
    }
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  }
  catch {
    return {}
  }
}

function formatCodexThreadFailure(event: ThreadEvent, diagnostics: CodexStreamDiagnostics): string {
  const suffix = ` (raw=${formatCodexDiagnostics(diagnostics)})`
  if (event.type === 'turn.failed') {
    return `Codex turn failed${suffix}`
  }
  return `Codex stream error${suffix}`
}

function collectCodexStreamDiagnostics(diagnostics: CodexStreamDiagnostics, event: ThreadEvent): void {
  diagnostics.totalEvents += 1
  incrementCount(diagnostics.eventTypeCounts, event.type)
  if (isItemEvent(event)) {
    incrementCount(diagnostics.itemTypeCounts, event.item.type)
  }
  if (diagnostics.sampleEvents.length < MAX_EVENT_SAMPLES) {
    diagnostics.sampleEvents.push(buildSampleEvent(event))
  }
}

function isItemEvent(event: ThreadEvent): event is Extract<ThreadEvent, { type: 'item.started' | 'item.updated' | 'item.completed' }> {
  return event.type === 'item.started' || event.type === 'item.updated' || event.type === 'item.completed'
}

function buildSampleEvent(event: ThreadEvent): Record<string, unknown> {
  if (!isItemEvent(event)) {
    return { type: event.type }
  }
  return { type: event.type, itemType: event.item.type, itemId: event.item.id }
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
    errorText: `Codex stream completed without mapped timeline events. ${formatCodexDiagnostics(diagnostics)}`,
  }
}

function formatCodexDiagnostics(diagnostics: CodexStreamDiagnostics): string {
  return `events_total=${diagnostics.totalEvents}, mapped_events=${diagnostics.mappedEvents}`
}
