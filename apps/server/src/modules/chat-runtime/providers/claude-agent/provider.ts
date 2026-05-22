import { randomUUID } from 'node:crypto'

import type { CanUseTool, Options, Query, SDKUserMessage, SlashCommand } from '@anthropic-ai/claude-agent-sdk'
import type { LangfuseGeneration } from '@langfuse/tracing'
import { startObservation } from '@langfuse/tracing'
import type { UIMessageChunk } from 'ai'
import { z } from 'zod'

import { langfuseEnabled } from '../../../../langfuse'
import { getRegisteredMcpServers } from '../../../../plugins'
import * as Approval from '../../../approval/service'
import { ClaudeAgentConfigJsonSchema, resolveApiKey } from '../../../providers/provider-base'
import type { RuntimeKind } from '../../../providers/types'
import type { TokenUsage } from '../../engine/ai-sdk-engine'
import type {
  CancelTurnInput,
  ChatRuntimeCapabilities,
  ChatRuntime,
  GetCapabilitiesInput,
  ResumeChatSessionInput,
  RuntimeSlashCommand,
  RuntimeSession,
  StartChatSessionInput,
  StreamTurnInput,
} from '../../runtime-provider-types'
import { WorkspaceProviderStateSnapshotJsonSchema } from '../provider-state-snapshot'
import type { ClaudeAgentChunkMapperState } from './mapper'
import { mapClaudeAgentMessageToChunks } from './mapper'

interface ClaudeAgentProviderDeps {
  readSecret: (credentialRef: string) => string
  resolveSkillPaths?: (workspacePath: string) => string[]
}

const RUNTIME_KIND: RuntimeKind = 'claude-agent'
type ActiveClaudeQuery = { query: Query, abortController: AbortController }
const LangfuseGenerationSpanSchema = z.object({
  otelSpan: z.object({
    setAttribute: z.function({
      input: [z.string(), z.string()],
      output: z.void(),
    }),
  }),
}).passthrough()

export class ClaudeAgentProvider implements ChatRuntime {
  readonly runtimeKind = RUNTIME_KIND

  private readonly activeQueries = new Map<string, ActiveClaudeQuery>()
  private _lastUsage: TokenUsage | null = null

  get lastUsage(): TokenUsage | null {
    return this._lastUsage
  }

  constructor(private readonly deps: ClaudeAgentProviderDeps) {}

  private releaseQuery(sessionId: string, entry: ActiveClaudeQuery): void {
    if (this.activeQueries.get(sessionId) === entry) {
      this.activeQueries.delete(sessionId)
    }
  }

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      agentProfileId: input.profile.id,
      runtimeKind: RUNTIME_KIND,
      providerSessionId: null,
      providerStateSnapshot: JSON.stringify({
        workspacePath: input.workspacePath,
        models: { currentModelId: input.modelId },
      }),
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

  async getCapabilities(input: GetCapabilitiesInput): Promise<ChatRuntimeCapabilities> {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const abortController = new AbortController()
    const queryOptions = buildClaudeQueryOptions({
      deps: this.deps,
      input,
      abortController,
      attachPermissionHandler: false,
    })
    const activeQuery = query({ prompt: emptyUserInput(), options: queryOptions })

    try {
      const slashCommands = await activeQuery.supportedCommands()

      return {
        runtimeKind: RUNTIME_KIND,
        slashCommands: slashCommands.map(toRuntimeSlashCommand),
        skills: [],
      }
    }
    finally {
      activeQuery.close()
    }
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')

    const abortController = new AbortController()
    const textItemId = randomUUID()
    const config = ClaudeAgentConfigJsonSchema.parse(input.profile.configJson)
    const effectiveModel = input.modelId ?? config.model
    const queryOptions = buildClaudeQueryOptions({
      deps: this.deps,
      input,
      abortController,
      attachPermissionHandler: true,
    })

    const activeQuery = query({ prompt: input.message, options: queryOptions })
    const sessionId = input.runtimeSession.chatSessionId
    const activeEntry: ActiveClaudeQuery = { query: activeQuery, abortController }
    this.activeQueries.set(sessionId, activeEntry)
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
      const span = LangfuseGenerationSpanSchema.parse(generation).otelSpan
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
      this.releaseQuery(sessionId, activeEntry)
    }
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const sessionId = input.runtimeSession.chatSessionId
    const entry = this.activeQueries.get(sessionId)
    if (!entry) {
      return
    }
    // Reject any pending approval prompts so the canUseTool callback unblocks
    Approval.rejectPendingBySession(sessionId)
    entry.abortController.abort()
    entry.query.close()
    this.releaseQuery(sessionId, entry)
  }
}

function buildClaudeQueryOptions(input: {
  deps: ClaudeAgentProviderDeps
  input: StreamTurnInput | GetCapabilitiesInput
  abortController: AbortController
  attachPermissionHandler: boolean
}): Options {
  const config = ClaudeAgentConfigJsonSchema.parse(input.input.profile.configJson)
  const apiKey = resolveApiKey(input.input.profile, config.apiKey, 'ANTHROPIC_API_KEY', input.deps)
  const effectiveModel = input.input.modelId ?? config.model

  if (!apiKey) {
    throw new Error('Claude Agent provider requires an API key')
  }

  const snapshot = WorkspaceProviderStateSnapshotJsonSchema.parse(input.input.runtimeSession.providerStateSnapshot)
  const queryOptions: Options = {
    abortController: input.abortController,
    model: effectiveModel,
    cwd: snapshot.workspacePath ?? input.input.workspacePath ?? process.cwd(),
    permissionMode: config.permissionMode,
    allowDangerouslySkipPermissions: config.permissionMode === 'bypassPermissions'
      ? true
      : config.allowDangerouslySkipPermissions,
    maxTurns: config.maxTurns,
    additionalDirectories: config.additionalDirectories,
    forwardSubagentText: true,
    agentProgressSummaries: true,
    systemPrompt: input.input.systemPrompt
      ? { type: 'preset' as const, preset: 'claude_code' as const, append: input.input.systemPrompt }
      : undefined,
    // Native Claude SDK support: discover and invoke all SDK-visible skills/commands.
    // Cradle-specific skill projection is intentionally out of scope for this pass.
    skills: 'all',
  }
  if (config.tools) {
    queryOptions.tools = config.tools
  }
  if (config.disallowedTools) {
    queryOptions.disallowedTools = config.disallowedTools
  }
  if (input.input.runtimeSession.providerSessionId) {
    queryOptions.resume = input.input.runtimeSession.providerSessionId
  }

  const registeredServers = getRegisteredMcpServers()
  if (Object.keys(registeredServers).length > 0) {
    queryOptions.mcpServers = { ...queryOptions.mcpServers, ...registeredServers }
  }

  queryOptions.env = {
    ...process.env,
    ANTHROPIC_API_KEY: apiKey,
    CRADLE_CHAT_SESSION_ID: input.input.runtimeSession.chatSessionId,
    CRADLE_WORKSPACE_ID: input.input.workspaceId ?? undefined,
    ...(config.baseUrl ? { ANTHROPIC_BASE_URL: config.baseUrl } : {}),
    ...buildClaudeAgentModelEnv(config.claudeAgent),
  }

  if (input.attachPermissionHandler && config.permissionMode !== 'bypassPermissions') {
    queryOptions.canUseTool = buildCanUseTool(input.input.runtimeSession.chatSessionId, input.abortController.signal)
  }

  return queryOptions
}

function buildClaudeAgentModelEnv(config: {
  modelAliases?: {
    haiku?: string
    sonnet?: string
    opus?: string
  }
  subagentModel?: string
} | undefined): Record<string, string> {
  const env: Record<string, string> = {}
  const aliases = config?.modelAliases
  if (aliases?.haiku) {
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = aliases.haiku
  }
  if (aliases?.sonnet) {
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = aliases.sonnet
  }
  if (aliases?.opus) {
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = aliases.opus
  }
  if (config?.subagentModel) {
    env.CLAUDE_CODE_SUBAGENT_MODEL = config.subagentModel
  }

  return env
}

async function* emptyUserInput(): AsyncGenerator<SDKUserMessage, void, void> {}

function toRuntimeSlashCommand(command: SlashCommand): RuntimeSlashCommand {
  return {
    name: command.name,
    description: command.description,
    argumentHint: command.argumentHint,
    aliases: command.aliases,
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
