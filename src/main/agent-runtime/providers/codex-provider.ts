// Input: AgentProfile config, credential reader, Codex SDK
// Output: CodexProvider that maps Codex App Server streams into typed timeline facts
// Position: Concrete Agent Runtime provider for OpenAI Codex CLI-backed agent sessions — thin orchestration shell

import { randomUUID } from 'node:crypto'

import type { Thread, ThreadEvent } from '@openai/codex-sdk'
import { Codex } from '@openai/codex-sdk'

import type { TimelineInputEvent } from '../../backend-control-plane/timeline-events'
import { OBSERVABILITY_CODES } from '../../observability/service'
import type { ObservabilitySink } from '../../observability/sink'
import { noopObservabilitySink } from '../../observability/sink'
import type { CodexAdapterState } from '../adapters/codex-adapter'
import { mapCodexThreadEvent } from '../adapters/codex-adapter'
import { enrichModelsFromRegistry } from '../model-info-registry'
import type { ProviderDeps } from '../provider-base'
import {
  buildFallbackModelList,
  CodexConfigSchema,
  normalizeBaseUrl,
  parseConfigWith,
  resolveApiKey,
} from '../provider-base'
import type {
  AgentProfile,
  CancelTurnInput,
  ChatRuntimeProvider,
  ModelDescriptor,
  ProviderKind,
  ProviderHealthCheckResult,
  ResumeChatSessionInput,
  RuntimeSession,
  StartChatSessionInput,
  StreamTurnInput,
  TokenUsage,
} from '../runtime-provider-types'

const PROVIDER_KIND: ProviderKind = 'codex'
const MAX_EVENT_SAMPLES = 20

export type CodexProviderDeps = ProviderDeps
  & {
    observability?: ObservabilitySink
  }

interface CodexStreamDiagnostics {
  totalEvents: number
  mappedEvents: number
  eventTypeCounts: Record<string, number>
  itemTypeCounts: Record<string, number>
  sampleEvents: Array<Record<string, unknown>>
}

export class CodexProvider implements ChatRuntimeProvider {
  readonly providerKind = PROVIDER_KIND

  private readonly activeThreads = new Map<string, { thread: Thread, abortController: AbortController }>()
  private readonly observability: ObservabilitySink
  private _lastUsage: TokenUsage | null = null
  get lastUsage(): TokenUsage | null { return this._lastUsage }

  constructor(private readonly deps: CodexProviderDeps) {
    this.observability = deps.observability ?? noopObservabilitySink
  }

  // ── Health Check / ListModels ─────────────────────────────────────────────

  async checkHealth(profile: AgentProfile): Promise<ProviderHealthCheckResult> {
    const config = parseConfigWith(profile.configJson, CodexConfigSchema)
    const apiKey = resolveApiKey(profile, config.apiKey, 'OPENAI_API_KEY', this.deps)
    if (!apiKey) {
      return {
        ok: false,
        label: profile.name,
        version: null,
        details: { baseUrl: config.baseUrl ?? null },
        errorText: 'API key is required (credential or OPENAI_API_KEY env)',
      }
    }
    return {
      ok: true,
      label: profile.name,
      version: null,
      details: { baseUrl: config.baseUrl ?? null, model: config.model ?? null },
      errorText: null,
    }
  }

  async listModels(profile: AgentProfile): Promise<ModelDescriptor[]> {
    const config = parseConfigWith(profile.configJson, CodexConfigSchema)
    const baseUrl = normalizeBaseUrl(config.baseUrl ?? 'https://api.openai.com/v1')
    const apiKey = resolveApiKey(profile, config.apiKey, 'OPENAI_API_KEY', this.deps)
    if (!apiKey) {
      return []
    }

    let models: ModelDescriptor[]
    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!response.ok) {
        models = buildFallbackModelList(PROVIDER_KIND, config.model)
      }
      else {
        const data = await response.json() as { data?: Array<{ id: string }> }
        if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
          models = buildFallbackModelList(PROVIDER_KIND, config.model)
        }
        else {
          const raw: ModelDescriptor[] = data.data.map(m => ({
            id: m.id,
            label: m.id,
            providerKind: PROVIDER_KIND,
            contextWindow: null,
          }))
          models = await enrichModelsFromRegistry(raw)
        }
      }
    }
    catch {
      models = buildFallbackModelList(PROVIDER_KIND, config.model)
    }

    // Apply per-provider model allow-list (undefined = all, [] = none, [...] = filter)
    const { enabledModels } = config
    if (enabledModels === undefined) {
      return models
    }
    if (enabledModels.length === 0) {
      return []
    }
    return models.filter(m => enabledModels.includes(m.id))
  }

  // ── Session Lifecycle ─────────────────────────────────────────────────────

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      agentProfileId: input.profile.id,
      providerKind: PROVIDER_KIND,
      providerSessionId: null,
      providerStateSnapshot: null,
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    return input.runtimeSession
  }

  // ── Stream Turn ───────────────────────────────────────────────────────────

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<TimelineInputEvent, void, void> {
    const { runtimeSession, profile, message, modelId: inputModelId } = input
    const config = parseConfigWith(profile.configJson, CodexConfigSchema)
    const apiKey = resolveApiKey(profile, config.apiKey, 'OPENAI_API_KEY', this.deps)
    const effectiveModel = inputModelId ?? config.model

    if (!apiKey) {
      throw new Error('Codex provider requires an API key')
    }

    const abortController = new AbortController()

    // Inject Cradle-owned skill paths
    const skillPaths = config.skillPaths ?? this.deps.resolveSkillPaths?.('.') ?? []
    const codexConfigObj: Record<string, string | string[]> = {}
    if (skillPaths.length > 0) {
      codexConfigObj.instructions_paths = skillPaths
    }

    const codex = new Codex({
      apiKey,
      baseUrl: config.baseUrl,
      config: Object.keys(codexConfigObj).length > 0 ? codexConfigObj : undefined,
    })

    const threadOptions = {
      model: effectiveModel,
      workingDirectory: '.' as const,
      sandboxMode: config.sandboxMode ?? ('workspace-write' as const),
      approvalPolicy: config.approvalPolicy ?? ('on-failure' as const),
      modelReasoningEffort: config.reasoningEffort ?? ('high' as const),
      additionalDirectories: config.additionalDirectories,
    }

    const thread = runtimeSession.providerSessionId
      ? codex.resumeThread(runtimeSession.providerSessionId, threadOptions)
      : codex.startThread(threadOptions)

    this.activeThreads.set(runtimeSession.chatSessionId, { thread, abortController })
    this._lastUsage = null

    const textItemId = randomUUID()
    let threadId: string | null = null
    const adapterState: CodexAdapterState = { textItemId, assistantStarted: false }
    const diagnostics: CodexStreamDiagnostics = {
      totalEvents: 0,
      mappedEvents: 0,
      eventTypeCounts: {},
      itemTypeCounts: {},
      sampleEvents: [],
    }

    try {
      const { events } = await thread.runStreamed(message, { signal: abortController.signal })

      for await (const event of events) {
        if (abortController.signal.aborted) {
          break
        }

        collectCodexStreamDiagnostics(diagnostics, event)

        if (event.type === 'turn.failed') {
          throw new Error(formatCodexThreadFailure(event, diagnostics))
        }

        if (event.type === 'error') {
          throw new Error(formatCodexThreadFailure(event, diagnostics))
        }

        // Delegate mapping to pure adapter function
        const result = mapCodexThreadEvent(event, adapterState)
        adapterState.assistantStarted = result.assistantStarted
        diagnostics.mappedEvents += result.events.length
        for (const te of result.events) {
          yield te
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

      if (threadId) {
        runtimeSession.providerSessionId = threadId
      }

      const outputValidation = validateCodexStreamOutput(diagnostics)
      if (!outputValidation.ok) {
        const errorText = outputValidation.errorText ?? 'Codex stream produced no timeline output events'
        this.observability.record({
          source: 'provider',
          code: OBSERVABILITY_CODES.providerEmptyEventStream,
          severity: 'error',
          category: 'provider',
          message: errorText,
          chatSessionId: runtimeSession.chatSessionId,
          attrs: {
            providerKind: PROVIDER_KIND,
            model: effectiveModel ?? null,
            baseUrl: config.baseUrl ?? null,
            providerSessionId: threadId,
            diagnostics,
          },
        })
        throw Object.assign(new Error(errorText), {
          code: OBSERVABILITY_CODES.providerEmptyEventStream,
          data: {
            details: {
              providerKind: PROVIDER_KIND,
              model: effectiveModel ?? null,
              baseUrl: config.baseUrl ?? null,
              providerSessionId: threadId,
              diagnostics,
            },
          },
        })
      }

      // Final completed event
      if (adapterState.assistantStarted) {
        yield {
          type: 'assistant.message.completed',
          itemId: textItemId,
          source: { backend: PROVIDER_KIND, eventType: 'turn.completed', itemId: textItemId },
        }
      }
    }
    finally {
      this.activeThreads.delete(runtimeSession.chatSessionId)
    }
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const entry = this.activeThreads.get(input.runtimeSession.chatSessionId)
    if (entry) {
      entry.abortController.abort()
      this.activeThreads.delete(input.runtimeSession.chatSessionId)
    }
  }
}

function formatCodexThreadFailure(event: ThreadEvent, diagnostics: CodexStreamDiagnostics): string {
  const suffix = ` (raw=${formatCodexDiagnostics(diagnostics)})`
  if (event.type === 'turn.failed') {
    const errorText = readEventError(event)
    return errorText
      ? `Codex turn failed: ${errorText}${suffix}`
      : `Codex turn failed${suffix}`
  }

  if (event.type === 'error') {
    const errorText = readEventError(event)
    return errorText
      ? `Codex stream error: ${errorText}${suffix}`
      : `Codex stream error${suffix}`
  }

  return `Codex stream failure${suffix}`
}

function readEventError(event: ThreadEvent): string | null {
  const record = event as unknown as Record<string, unknown>
  const directError = record.error

  if (typeof directError === 'string' && directError.length > 0) {
    return directError
  }

  if (typeof directError === 'object' && directError !== null) {
    const errorObj = directError as Record<string, unknown>
    if (typeof errorObj.message === 'string' && errorObj.message.length > 0) {
      return errorObj.message
    }
    try {
      return JSON.stringify(errorObj)
    }
    catch {
      return String(errorObj)
    }
  }

  if (typeof record.message === 'string' && record.message.length > 0) {
    return record.message
  }

  return null
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

  const item = event.item
  const sample: Record<string, unknown> = {
    type: event.type,
    itemType: item.type,
    itemId: item.id,
  }

  if ('status' in item) {
    sample.itemStatus = item.status
  }
  if ('text' in item && typeof item.text === 'string') {
    sample.textChars = item.text.length
  }
  if ('command' in item && typeof item.command === 'string') {
    sample.command = item.command
  }
  if ('tool' in item && typeof item.tool === 'string') {
    sample.tool = item.tool
  }
  if ('server' in item && typeof item.server === 'string') {
    sample.server = item.server
  }
  if ('query' in item && typeof item.query === 'string') {
    sample.query = item.query
  }

  return sample
}

function incrementCount(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1
}

function validateCodexStreamOutput(
  diagnostics: CodexStreamDiagnostics,
): { ok: boolean, errorText: string | null } {
  if (diagnostics.mappedEvents > 0) {
    return { ok: true, errorText: null }
  }

  return {
    ok: false,
    errorText: `Codex stream completed without mapped timeline events. ${formatCodexDiagnostics(diagnostics)}. This usually indicates an upstream endpoint/model incompatibility with Codex event streaming.`,
  }
}

function formatCodexDiagnostics(diagnostics: CodexStreamDiagnostics): string {
  const eventTypes = formatCountMap(diagnostics.eventTypeCounts)
  const itemTypes = formatCountMap(diagnostics.itemTypeCounts)
  return `events_total=${diagnostics.totalEvents}, mapped_events=${diagnostics.mappedEvents}, event_types=${eventTypes}, item_types=${itemTypes}`
}

function formatCountMap(counts: Record<string, number>): string {
  const entries = Object.entries(counts)
  if (entries.length === 0) {
    return '-'
  }
  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}`)
    .join(',')
}
