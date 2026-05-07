// Input: AgentProfile config, credential reader, Claude Agent SDK
// Output: ClaudeAgentProvider that maps Claude Agent SDK streams into typed timeline facts
// Position: Concrete Agent Runtime provider for Claude Code (via @anthropic-ai/claude-agent-sdk) — thin orchestration shell

import { randomUUID } from 'node:crypto'

import type { Options, Query } from '@anthropic-ai/claude-agent-sdk'

import type { TimelineInputEvent } from '../../backend-control-plane/timeline-events'
import type { ClaudeAgentAdapterState } from '../adapters/claude-agent-adapter'
import { mapClaudeAgentMessage } from '../adapters/claude-agent-adapter'
import { enrichModelsFromRegistry } from '../model-info-registry'
import type { ProviderDeps } from '../provider-base'
import {
  buildFallbackModelList,
  ClaudeAgentConfigSchema,
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
  ProviderProbeResult,
  ResumeChatSessionInput,
  RuntimeSession,
  StartChatSessionInput,
  StreamTurnInput,
  TokenUsage,
} from '../runtime-provider-types'

const PROVIDER_KIND: ProviderKind = 'claude-agent'

const CLAUDE_DEFAULTS = [
  { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', contextWindow: 200000 },
  { id: 'claude-opus-4-20250514', label: 'Claude Opus 4', contextWindow: 200000 },
]

export type ClaudeAgentProviderDeps = ProviderDeps

export class ClaudeAgentProvider implements ChatRuntimeProvider {
  readonly providerKind = PROVIDER_KIND

  private readonly activeQueries = new Map<string, { query: Query, abortController: AbortController }>()
  private _lastUsage: TokenUsage | null = null
  get lastUsage(): TokenUsage | null { return this._lastUsage }

  constructor(private readonly deps: ClaudeAgentProviderDeps) {}

  // ── Probe / ListModels ────────────────────────────────────────────────────

  async probe(profile: AgentProfile): Promise<ProviderProbeResult> {
    const config = parseConfigWith(profile.configJson, ClaudeAgentConfigSchema)
    const apiKey = resolveApiKey(profile, config.apiKey, 'ANTHROPIC_API_KEY', this.deps)
    if (!apiKey) {
      return {
        ok: false,
        label: profile.name,
        version: null,
        details: {},
        errorText: 'API key is required (credential or ANTHROPIC_API_KEY env)',
      }
    }
    return {
      ok: true,
      label: profile.name,
      version: null,
      details: { model: config.model ?? null },
      errorText: null,
    }
  }

  async listModels(profile: AgentProfile): Promise<ModelDescriptor[]> {
    const config = parseConfigWith(profile.configJson, ClaudeAgentConfigSchema)
    const baseUrl = normalizeBaseUrl(config.baseUrl ?? 'https://api.anthropic.com/v1')
    const apiKey = resolveApiKey(profile, config.apiKey, 'ANTHROPIC_API_KEY', this.deps)
    if (!apiKey) {
      return []
    }

    let models: ModelDescriptor[]
    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      })
      if (!response.ok) {
        models = buildFallbackModelList(PROVIDER_KIND, config.model, CLAUDE_DEFAULTS)
      }
      else {
        const data = await response.json() as { data?: Array<{ id: string, display_name?: string }> }
        if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
          models = buildFallbackModelList(PROVIDER_KIND, config.model, CLAUDE_DEFAULTS)
        }
        else {
          const raw: ModelDescriptor[] = data.data.map(m => ({
            id: m.id,
            label: m.display_name ?? m.id,
            providerKind: PROVIDER_KIND,
            contextWindow: null,
          }))
          models = await enrichModelsFromRegistry(raw)
        }
      }
    }
    catch {
      models = buildFallbackModelList(PROVIDER_KIND, config.model, CLAUDE_DEFAULTS)
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
    const config = parseConfigWith(profile.configJson, ClaudeAgentConfigSchema)
    const apiKey = resolveApiKey(profile, config.apiKey, 'ANTHROPIC_API_KEY', this.deps)
    const effectiveModel = inputModelId ?? config.model

    if (!apiKey) {
      throw new Error('Claude Agent provider requires an API key')
    }

    // Lazy import because claude-agent-sdk is ESM-only
    const { query } = await import('@anthropic-ai/claude-agent-sdk')

    const abortController = new AbortController()
    const textItemId = randomUUID()

    // Resolve skills to inject
    const skillPaths = config.skillPaths ?? this.deps.resolveSkillPaths?.('.') ?? []

    const queryOptions: Options = {
      abortController,
      model: effectiveModel,
      permissionMode: config.permissionMode ?? 'acceptEdits',
      allowDangerouslySkipPermissions: config.permissionMode === 'bypassPermissions'
        ? true
        : config.allowDangerouslySkipPermissions,
      maxTurns: config.maxTurns,
      additionalDirectories: config.additionalDirectories,
    }

    // Skills injection
    if (config.skills) {
      queryOptions.skills = config.skills
    }
    else if (skillPaths.length > 0) {
      queryOptions.skills = skillPaths
    }

    if (config.tools) {
      queryOptions.tools = config.tools
    }
    if (config.disallowedTools) {
      queryOptions.disallowedTools = config.disallowedTools
    }

    // Resume session
    if (runtimeSession.providerSessionId) {
      queryOptions.resume = runtimeSession.providerSessionId
    }

    // Set env with API key
    queryOptions.env = {
      ...process.env,
      ANTHROPIC_API_KEY: apiKey,
    }

    const q = query({
      prompt: message,
      options: queryOptions as Options,
    })

    this.activeQueries.set(runtimeSession.chatSessionId, { query: q, abortController })
    this._lastUsage = null

    const adapterState: ClaudeAgentAdapterState = { textItemId, assistantStarted: false }

    try {
      for await (const msg of q) {
        if (abortController.signal.aborted) {
          break
        }

        // Delegate mapping to pure adapter function
        const result = mapClaudeAgentMessage(msg, adapterState)
        adapterState.assistantStarted = result.assistantStarted

        for (const event of result.events) {
          yield event
        }

        // Capture session ID
        if (result.sessionId && !runtimeSession.providerSessionId) {
          runtimeSession.providerSessionId = result.sessionId
        }

        // Capture usage
        if (result.usage) {
          this._lastUsage = result.usage
        }
      }

      // Final completed event
      if (adapterState.assistantStarted) {
        yield {
          type: 'assistant.message.completed',
          itemId: textItemId,
          source: { backend: PROVIDER_KIND, eventType: 'result', itemId: textItemId },
        }
      }
    }
    finally {
      this.activeQueries.delete(runtimeSession.chatSessionId)
    }
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const entry = this.activeQueries.get(input.runtimeSession.chatSessionId)
    if (entry) {
      entry.abortController.abort()
      entry.query.return(undefined)
      this.activeQueries.delete(input.runtimeSession.chatSessionId)
    }
  }
}
