// Input: Claude Agent SDK, provider config helpers, and credential reader
// Output: claude-agent chat runtime provider for unified server chat execution
// Position: apps/server/src/modules/chat-runtime/providers/claude-agent/provider.ts

import { randomUUID } from 'node:crypto'

import type { CanUseTool, Options, Query } from '@anthropic-ai/claude-agent-sdk'
import type { LangfuseGeneration } from '@langfuse/tracing'
import { startObservation } from '@langfuse/tracing'
import type { UIMessageChunk } from 'ai'

import { langfuseEnabled } from '../../../../langfuse'
import * as Approval from '../../../approval/service'
import { ClaudeAgentConfigSchema, parseConfigWith, resolveApiKey } from '../../../providers/provider-base'
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
import type { ClaudeAgentChunkMapperState } from './mapper'
import { mapClaudeAgentMessageToChunks } from './mapper'

interface ClaudeAgentProviderDeps {
  readSecret: (credentialRef: string) => string
  resolveSkillPaths?: (workspacePath: string) => string[]
}

const RUNTIME_KIND: RuntimeKind = 'claude-agent'

export class ClaudeAgentProvider implements ChatRuntime {
  readonly runtimeKind = RUNTIME_KIND

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
      runtimeKind: RUNTIME_KIND,
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

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
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
    const queryOptions: Options = {
      abortController,
      model: effectiveModel,
      cwd: snapshot.workspacePath ?? process.cwd(),
      permissionMode: config.permissionMode ?? 'acceptEdits',
      allowDangerouslySkipPermissions: config.permissionMode === 'bypassPermissions'
        ? true
        : config.allowDangerouslySkipPermissions,
      maxTurns: config.maxTurns ?? 100,
      additionalDirectories: config.additionalDirectories,
      forwardSubagentText: true,
      agentProgressSummaries: true,
      // Inject system prompt: use Claude Code default + append our workflow/agent instructions
      systemPrompt: input.systemPrompt
        ? { type: 'preset' as const, preset: 'claude_code' as const, append: input.systemPrompt }
        : undefined,
      // TODO: skills option expects names (e.g. ['pdf', 'docx']), not directory paths.
      // resolveSkillPaths() returns filesystem directories, which is incompatible.
      // Revisit to convert paths -> skill names, then restore per-profile filtering.
      skills: 'all',
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
      CRADLE_CHAT_SESSION_ID: input.runtimeSession.chatSessionId,
      CRADLE_WORKSPACE_ID: input.workspaceId ?? undefined,
      ...(config.baseUrl ? { ANTHROPIC_BASE_URL: config.baseUrl } : {}),
    }

    // Wire permission prompts through the approval system so the web UI can respond
    if (config.permissionMode !== 'bypassPermissions') {
      const chatSessionId = input.runtimeSession.chatSessionId
      queryOptions.canUseTool = buildCanUseTool(chatSessionId, abortController.signal)
    }

    const activeQuery = query({ prompt: input.message, options: queryOptions })
    this.activeQueries.set(input.runtimeSession.chatSessionId, { query: activeQuery, abortController })
    this._lastUsage = null

    const mapperState: ClaudeAgentChunkMapperState = { textItemId, assistantStarted: false, hadToolCallSinceLastText: false, activeToolBlockIds: new Map(), currentParentToolUseId: null }

    // Langfuse tracing via @langfuse/tracing SDK
    let generation: LangfuseGeneration | null = null
    if (langfuseEnabled) {
      generation = startObservation('claude-agent-generation', {
        model: effectiveModel,
        input: input.systemPrompt
          ? [{ role: 'system', content: input.systemPrompt }, { role: 'user', content: input.message }]
          : [{ role: 'user', content: input.message }],
      }, { asType: 'generation' }) as LangfuseGeneration
      // Set trace-level attributes for session grouping
      const span = (generation as unknown as { otelSpan: { setAttribute: (k: string, v: string) => void } }).otelSpan
      span.setAttribute('langfuse.session.id', input.runtimeSession.chatSessionId)
      span.setAttribute('langfuse.trace.name', 'claude-agent-chat')
    }
    let outputTextCollector = ''

    try {
      for await (const message of activeQuery) {
        if (abortController.signal.aborted) {
          break
        }

        const result = mapClaudeAgentMessageToChunks(message, mapperState)
        mapperState.assistantStarted = result.assistantStarted

        for (const chunk of result.chunks) {
          // Collect text output for Langfuse
          if (generation && chunk.type === 'text-delta' && 'delta' in chunk) {
            outputTextCollector += (chunk as { delta: string }).delta
          }
          yield chunk
        }

        if (result.sessionId && !input.runtimeSession.providerSessionId) {
          input.runtimeSession.providerSessionId = result.sessionId
        }

        if (result.usage) {
          this._lastUsage = result.usage
        }
      }

      if (mapperState.assistantStarted) {
        yield { type: 'text-end', id: mapperState.textItemId }
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
      this.activeQueries.delete(input.runtimeSession.chatSessionId)
    }
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const entry = this.activeQueries.get(input.runtimeSession.chatSessionId)
    if (!entry) {
      return
    }
    // Reject any pending approval prompts so the canUseTool callback unblocks
    Approval.rejectPendingBySession(input.runtimeSession.chatSessionId)
    entry.abortController.abort()
    entry.query.close()
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

function buildCanUseTool(chatSessionId: string, abortSignal: AbortSignal): CanUseTool {
  return async (toolName, _input, options) => {
    if (process.env.CRADLE_HEADLESS === '1') {
      return process.env.CRADLE_TOOL_APPROVAL === 'auto'
        ? { behavior: 'allow' as const, updatedInput: {}, toolUseID: options.toolUseID }
        : { behavior: 'deny' as const, message: 'Headless mode: auto-deny', toolUseID: options.toolUseID }
    }

    if (abortSignal.aborted) {
      return { behavior: 'deny' as const, message: 'Session aborted', toolUseID: options.toolUseID }
    }

    const policyKeys = Approval.generatePolicyKeys({
      runtimeKind: 'claude-agent',
      chatSessionId,
      toolName,
    })
    if (Approval.isPreviouslyAllowed(chatSessionId, policyKeys)) {
      return { behavior: 'allow' as const, updatedInput: {}, toolUseID: options.toolUseID }
    }

    const prompt = options.title ?? options.displayName ?? `Allow "${toolName}"?`

    const approvalOptions = [
      { optionId: 'allow', label: 'Allow', description: 'allow_once' },
      { optionId: 'allow_always', label: 'Always Allow', description: 'allow_always' },
      { optionId: 'deny', label: 'Deny', description: 'reject_once' },
    ]

    const response = await Approval.requestApproval({
      chatSessionId,
      agentId: 'claude-agent',
      prompt,
      options: approvalOptions,
    })

    if (response.decision === 'rejected' || response.selectedOptionId === 'deny') {
      return {
        behavior: 'deny' as const,
        message: 'User denied permission',
        toolUseID: options.toolUseID,
      }
    }

    if (response.selectedOptionId === 'allow_always') {
      Approval.markAllowed(chatSessionId, policyKeys)
    }

    return {
      behavior: 'allow' as const,
      updatedInput: {},
      toolUseID: options.toolUseID,
    }
  }
}
