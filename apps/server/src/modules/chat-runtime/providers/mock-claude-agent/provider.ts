import { randomUUID } from 'node:crypto'

import type { UIMessageChunk } from 'ai'
import { z } from 'zod'

import * as Approval from '../../../approval/service'
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
import type { ClaudeAgentChunkMapperState } from '../claude-agent/mapper'
import { mapClaudeAgentMessageToChunks } from '../claude-agent/mapper'
import { WorkspaceProviderStateSnapshotJsonSchema } from '../provider-state-snapshot'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

const RUNTIME_KIND = 'claude-agent' as RuntimeKind
const TRAILING_SLASH_RE = /\/$/
const DEFAULT_MOCK_BASE_URL = process.env.CRADLE_MOCK_LLM_URL?.trim() || 'http://127.0.0.1:56344/v1'
const MockClaudeAgentConfigJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.object({
    baseUrl: z.union([
      z.string().trim().min(1),
      z.literal('').transform(() => DEFAULT_MOCK_BASE_URL),
    ]).default(DEFAULT_MOCK_BASE_URL),
  }).passthrough())
const ClaudeAgentToolUseStreamEventSchema = z.object({
  type: z.literal('stream_event'),
  event: z.object({
    type: z.literal('content_block_start'),
    content_block: z.object({
      type: z.literal('tool_use'),
      name: z.string(),
    }).passthrough(),
  }).passthrough(),
})
const ClaudeAgentSdkMessageSchema = z.object({
  type: z.string(),
}).passthrough()
  .transform((message) => {
    const approvalToolName = z.union([
      ClaudeAgentToolUseStreamEventSchema.transform(value => value.event.content_block.name),
      z.object({ type: z.string() }).passthrough().transform(() => null),
    ]).parse(message)
    return {
      message: z.custom<SDKMessage>().parse(message),
      approvalToolName,
    }
  })
const SdkMessageJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(ClaudeAgentSdkMessageSchema)
type ClaudeAgentSdkMessage = z.infer<typeof ClaudeAgentSdkMessageSchema>

export class MockClaudeAgentProvider implements ChatRuntime {
  readonly runtimeKind = RUNTIME_KIND

  private readonly activeAbortControllers = new Map<string, AbortController>()
  private _lastUsage: TokenUsage | null = null

  get lastUsage(): TokenUsage | null {
    return this._lastUsage
  }

  private releaseTurn(sessionId: string, abortController: AbortController): void {
    if (this.activeAbortControllers.get(sessionId) === abortController) {
      this.activeAbortControllers.delete(sessionId)
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

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    const config = MockClaudeAgentConfigJsonSchema.parse(input.profile.configJson)
    const { baseUrl } = config

    const abortController = new AbortController()
    const sessionId = input.runtimeSession.chatSessionId
    this.activeAbortControllers.set(sessionId, abortController)
    this._lastUsage = null

    const textItemId = randomUUID()
    const mapperState: ClaudeAgentChunkMapperState = {
      textItemId,
      assistantStarted: false,
      hadToolCallSinceLastText: false,
      activeToolBlockIds: new Map(),
      currentParentToolUseId: null,
    }

    try {
      const queryUrl = `${baseUrl.replace(TRAILING_SLASH_RE, '')}/v1/claude-agent/query`
      const response = await fetch(queryUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: input.message }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        throw new Error(`Mock server returned ${response.status}: ${response.statusText}`)
      }

      if (!response.body) {
        throw new Error('Mock server returned empty body')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) {
            continue
          }

          const jsonStr = trimmed.slice(6)
          if (jsonStr === '[DONE]') {
            continue
          }

          const parsedMessage = SdkMessageJsonSchema.parse(jsonStr)

          // Intercept tool_use blocks to gate through approval (like the real Claude Agent SDK)
          if (await this.shouldGateToolUse(parsedMessage, input.runtimeSession.chatSessionId, abortController.signal)) {
            // Approval was denied — skip this tool execution
            continue
          }

          const result = mapClaudeAgentMessageToChunks(parsedMessage.message, mapperState)
          mapperState.assistantStarted = result.assistantStarted
          for (const chunk of result.chunks) {
            yield chunk
          }
        }

        if (abortController.signal.aborted) {
          break
        }
      }

      if (mapperState.assistantStarted) {
        yield { type: 'text-end', id: mapperState.textItemId }
      }
    }
    finally {
      this.releaseTurn(sessionId, abortController)
    }
  }

  /**
   * Check if a streamed SDKMessage is a tool_use that requires approval.
   * Returns true if the tool was DENIED (caller should skip), false to proceed.
   */
  private async shouldGateToolUse(parsedMessage: ClaudeAgentSdkMessage, chatSessionId: string, signal: AbortSignal): Promise<boolean> {
    if (parsedMessage.approvalToolName === null) {
      return false
    }

    const toolName = parsedMessage.approvalToolName
    // Skip Agent tool — subagent spawning doesn't need approval
    if (toolName === 'Agent') {
      return false
    }

    // Check if previously allowed
    const policyKeys = Approval.generatePolicyKeys({
      runtimeKind: 'claude-agent',
      chatSessionId,
      toolName,
    })
    if (Approval.isPreviouslyAllowed(chatSessionId, policyKeys)) {
      return false
    }

    if (signal.aborted) {
      return true
    }

    const prompt = `Allow "${toolName}"?`
    const response = await Approval.requestApproval({
      chatSessionId,
      agentId: 'mock-claude-agent',
      prompt,
      options: [
        { optionId: 'allow', label: 'Allow', description: 'allow_once' },
        { optionId: 'allow_always', label: 'Always Allow', description: 'allow_always' },
        { optionId: 'deny', label: 'Deny', description: 'reject_once' },
      ],
    })

    if (response.decision === 'rejected' || response.selectedOptionId === 'deny') {
      return true // denied
    }
    if (response.selectedOptionId === 'allow_always') {
      Approval.markAllowed(chatSessionId, policyKeys)
    }
    return false // approved
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    Approval.rejectPendingBySession(input.runtimeSession.chatSessionId)
    const sessionId = input.runtimeSession.chatSessionId
    const ctrl = this.activeAbortControllers.get(sessionId)
    if (ctrl) {
      ctrl.abort()
      this.releaseTurn(sessionId, ctrl)
    }
  }
}
