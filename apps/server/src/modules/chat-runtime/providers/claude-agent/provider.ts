// Input: Claude Agent SDK, provider config helpers, and credential reader
// Output: claude-agent chat runtime provider for unified server chat execution
// Position: apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts

import { randomUUID } from 'node:crypto'

import type { Options, Query } from '@anthropic-ai/claude-agent-sdk'

import { ClaudeAgentConfigSchema, parseConfigWith, resolveApiKey } from '../../../providers/provider-base'
import type { ProviderKind } from '../../../providers/types'
import type {
  CancelTurnInput,
  ChatRuntimeProvider,
  ResumeChatSessionInput,
  RuntimeSession,
  StartChatSessionInput,
  StreamTurnInput,
  TimelineInputEvent,
  TokenUsage,
} from '../../runtime-provider-types'
import type { ClaudeAgentTimelineMapperState } from './mapper'
import { mapClaudeAgentMessageToTimeline } from './mapper'

interface ClaudeAgentProviderDeps {
  readSecret: (credentialRef: string) => string
  resolveSkillPaths?: (workspacePath: string) => string[]
}

const PROVIDER_KIND: ProviderKind = 'claude-agent'

export class ClaudeAgentProvider implements ChatRuntimeProvider {
  readonly providerKind = PROVIDER_KIND

  private readonly activeQueries = new Map<string, { query: Query, abortController: AbortController }>()
  private _lastUsage: TokenUsage | null = null

  get lastUsage(): TokenUsage | null {
    return this._lastUsage
  }

  constructor(private readonly deps: ClaudeAgentProviderDeps) {}

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      agentProfileId: input.profile.id,
      providerKind: PROVIDER_KIND,
      providerSessionId: null,
      providerStateSnapshot: JSON.stringify({
        workspacePath: input.workspacePath,
        models: { currentModelId: input.modelId ?? null },
      }),
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

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<TimelineInputEvent, void, void> {
    const config = parseConfigWith(input.profile.configJson, ClaudeAgentConfigSchema)
    const apiKey = resolveApiKey(input.profile, config.apiKey, 'ANTHROPIC_API_KEY', this.deps)
    const effectiveModel = input.modelId ?? config.model

    if (!apiKey) {
      throw new Error('Claude Agent provider requires an API key')
    }

    const { query } = await import('@anthropic-ai/claude-agent-sdk')

    const abortController = new AbortController()
    const textItemId = randomUUID()
    const snapshot = parseProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const skillPaths = config.skillPaths ?? this.deps.resolveSkillPaths?.(snapshot.workspacePath ?? '.') ?? []

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
    if (input.runtimeSession.providerSessionId) {
      queryOptions.resume = input.runtimeSession.providerSessionId
    }

    queryOptions.env = {
      ...process.env,
      ANTHROPIC_API_KEY: apiKey,
    }

    const activeQuery = query({ prompt: input.message, options: queryOptions })
    this.activeQueries.set(input.runtimeSession.chatSessionId, { query: activeQuery, abortController })
    this._lastUsage = null

    const mapperState: ClaudeAgentTimelineMapperState = { textItemId, assistantStarted: false }

    try {
      for await (const message of activeQuery) {
        if (abortController.signal.aborted) {
          break
        }

        const result = mapClaudeAgentMessageToTimeline(message, mapperState)
        mapperState.assistantStarted = result.assistantStarted

        for (const event of result.events) {
          yield event
        }

        if (result.sessionId && !input.runtimeSession.providerSessionId) {
          input.runtimeSession.providerSessionId = result.sessionId
        }

        if (result.usage) {
          this._lastUsage = result.usage
        }
      }

      if (mapperState.assistantStarted) {
        yield {
          type: 'assistant.message.completed',
          itemId: textItemId,
          source: { backend: PROVIDER_KIND, eventType: 'result', itemId: textItemId },
        }
      }
    }
    finally {
      this.activeQueries.delete(input.runtimeSession.chatSessionId)
    }
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const entry = this.activeQueries.get(input.runtimeSession.chatSessionId)
    if (!entry) {
      return
    }
    entry.abortController.abort()
    await entry.query.return(undefined)
    this.activeQueries.delete(input.runtimeSession.chatSessionId)
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
