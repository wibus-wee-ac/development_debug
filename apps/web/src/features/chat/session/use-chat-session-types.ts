import type { UIMessage } from 'ai'

import { useChatStore } from '~/store/chat'

import type { ChatContinuationMode, ChatQueueItem, ChatRuntimeSettingsPatch, ChatThinkingEffort } from '../commands/chat-response-command'

// ── Message Snapshot Types ──────────────────────────────────

export interface ChatSessionMessageRow {
  messageId: string
  role: 'user' | 'assistant'
  status: string
  errorText?: string | null
  content: string
  message: UIMessage
  parentMessageId: string | null
  parentToolCallId: string | null
  taskId: string | null
  depth: number
}
export type { ChatContinuationMode, ChatQueueItem }

export interface SendMessageOptions {
  providerTargetId?: string
  modelId?: string
  thinkingEffort?: ChatThinkingEffort | null | undefined
  runtimeSettings?: ChatRuntimeSettingsPatch
  continuationMode?: ChatContinuationMode
}

export type SendMessageResult = void | {
  kind: 'side-conversation'
  sideConversationId: string
  parentSessionId: string
}

export interface ToolApprovalResponseInput {
  messageId: string
  approvalId: string
  approved: boolean
  reason?: string
}

export interface RuntimeUserInputSubmitInput {
  messageId: string
  toolCallId: string
  answers: Record<string, string[]>
}

// ── Utility Functions ──────────────────────────────────────

export function projectMainMessagesFromSnapshotRows(rows: ChatSessionMessageRow[]): UIMessage[] {
  return rows.flatMap((row) => {
    if (row.parentToolCallId) {
      return []
    }
    return [row.message]
  })
}

export function projectStreamingMainAssistantMessageIds(rows: ChatSessionMessageRow[]): string[] {
  return rows.flatMap((row) => {
    if (row.role !== 'assistant' || row.status !== 'streaming' || row.parentToolCallId) {
      return []
    }
    return [row.messageId]
  })
}

export type PublicStatus = import('~/store/chat').PublicStatus

export function derivePassiveStatus(rows: ChatSessionMessageRow[]): PublicStatus {
  if (rows.some(row => row.status === 'streaming')) {
    return 'streaming'
  }
  const latestAssistant = [...rows].reverse().find(row => row.role === 'assistant')
  if (latestAssistant?.status === 'failed') {
    return 'error'
  }
  return 'idle'
}

export function readLatestFailedMainAssistantRow(rows: ChatSessionMessageRow[]): ChatSessionMessageRow | undefined {
  const latestAssistant = [...rows]
    .reverse()
    .find(row => row.role === 'assistant' && !row.parentToolCallId)
  return latestAssistant?.status === 'failed' ? latestAssistant : undefined
}

export function isEmptyStreamingMainAssistantRow(row: ChatSessionMessageRow): boolean {
  return row.role === 'assistant'
    && row.status === 'streaming'
    && !row.parentToolCallId
    && row.message.parts.length === 0
}

export function shouldHoldEmptyStreamingSnapshot(input: {
  rows: ChatSessionMessageRow[]
  runtimeStatusKnown: boolean
  runtimeIdle: boolean
  snapshotFetching: boolean
}): boolean {
  if (!input.rows.some(isEmptyStreamingMainAssistantRow)) {
    return false
  }
  if (input.snapshotFetching) {
    return true
  }
  if (!input.runtimeStatusKnown) {
    return true
  }
  return input.runtimeIdle
}

export function projectRowsWithoutEmptyStreamingAssistant(rows: ChatSessionMessageRow[]): ChatSessionMessageRow[] {
  return rows.filter(row => !isEmptyStreamingMainAssistantRow(row))
}

export function readStableSnapshotRows(rows: ChatSessionMessageRow[]): ChatSessionMessageRow[] | null {
  return rows.some(row => row.status === 'streaming') ? null : rows
}

export function isMatchingApprovalPart(part: UIMessage['parts'][number], approvalId: string): boolean {
  if (!(part.type === 'dynamic-tool' || part.type.startsWith('tool-'))) {
    return false
  }
  const approval = (part as { approval?: { id?: unknown } }).approval
  return typeof approval?.id === 'string' && approval.id === approvalId
}

export function isMatchingToolPart(part: UIMessage['parts'][number], toolCallId: string): boolean {
  return (part.type === 'dynamic-tool' || part.type.startsWith('tool-'))
    && (part as { toolCallId?: unknown }).toolCallId === toolCallId
}

export function readRuntimeUserInputRequestId(toolCallId: string): string {
  return toolCallId.startsWith('server-request-')
    ? toolCallId.slice('server-request-'.length)
    : toolCallId
}

// ── Constants ──────────────────────────────────────────────

export const SNAPSHOT_SYNC_DEBOUNCE_MS = 75
export const QUEUE_DRAIN_SYNC_DELAY_MS = 150
export const EMPTY_QUEUE_ITEMS: ChatQueueItem[] = []
export const BANG_COMMAND_DRIVER_PREFIX = 'bang-command'
export const STEER_FALLBACK_ERROR_CODES = new Set(['chat_steer_context_mismatch', 'chat_steer_no_active_run'])
export const CODEX_PLAN_IMPLEMENTATION_PROMPT_PREFIX = 'PLEASE IMPLEMENT THIS PLAN:'
export const CODEX_PLAN_IMPLEMENTATION_APPROVAL_PREFIX = 'implement-plan:'

// ── Internal Helpers ──────────────────────────────────────

export interface PlanImplementationApprovalRequest {
  toolCallId: string
  planContent: string
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readBuiltinToolCallInputPayload(value: unknown): { apiName: string, args: unknown } | null {
  if (!isRecord(value) || value.type !== 'cradle.builtin-tool-call.input.v1' || typeof value.apiName !== 'string') {
    return null
  }
  return {
    apiName: value.apiName,
    args: value.args,
  }
}

export function readToolApiName(part: UIMessage['parts'][number]): string | null {
  const inputPayload = readBuiltinToolCallInputPayload((part as { input?: unknown }).input)
  if (inputPayload) {
    return inputPayload.apiName
  }
  const toolName = (part as { toolName?: unknown }).toolName
  if (typeof toolName === 'string') {
    return toolName
  }
  return part.type.startsWith('tool-') ? part.type.slice('tool-'.length) : null
}

export function readPlanContentFromInput(input: unknown): string | null {
  const inputPayload = readBuiltinToolCallInputPayload(input)
  const args = inputPayload ? inputPayload.args : input
  if (!isRecord(args) || typeof args.planContent !== 'string') {
    return null
  }
  const planContent = args.planContent.trim()
  return planContent.length > 0 ? planContent : null
}

export function readPlanImplementationApprovalRequest(
  messages: UIMessage[],
  response: ToolApprovalResponseInput,
): PlanImplementationApprovalRequest | null {
  if (!response.approvalId.startsWith(CODEX_PLAN_IMPLEMENTATION_APPROVAL_PREFIX)) {
    return null
  }
  const message = messages.find(item => item.id === response.messageId)
  const part = message?.parts.find(item => isMatchingApprovalPart(item, response.approvalId))
  if (!part || !('toolCallId' in part) || typeof part.toolCallId !== 'string') {
    return null
  }
  if (part.toolCallId !== response.approvalId || readToolApiName(part) !== 'plan_implementation') {
    return null
  }
  const planContent = readPlanContentFromInput((part as { input?: unknown }).input)
  return planContent ? { toolCallId: part.toolCallId, planContent } : null
}

export function readSideChatCommand(text: string): string | null {
  const normalized = text.trimStart()
  if (!normalized.startsWith('/side')) {
    return null
  }
  const nextChar = normalized.charAt('/side'.length)
  if (nextChar && nextChar !== ' ' && nextChar !== '\t') {
    return null
  }
  return normalized.slice('/side'.length).trim()
}

export function releaseStaleSessionStreamingState(sessionId: string): void {
  const state = useChatStore.getState()
  const meta = state.sessionMetaMap.get(sessionId)
  const messageIds = new Set((state.messagesMap.get(sessionId) ?? []).map(message => message.id))
  if (meta?.localDriverMessageId) {
    messageIds.add(meta.localDriverMessageId)
  }

  for (const messageId of messageIds) {
    if (
      state.generatingMessageIds.has(messageId)
      || state.passiveStreamingMessageIds.has(messageId)
      || meta?.localDriverMessageId === messageId
    ) {
      state.finishGeneration(messageId)
    }
  }
  state.setPassiveStreamingMessageIds(sessionId, [])
  state.setSessionMeta(sessionId, {
    cancelling: false,
    locallyDriving: false,
    localDriverMessageId: undefined,
    passiveStatus: 'idle',
  })
}

export function releasePassiveSessionStreamingState(sessionId: string): void {
  const state = useChatStore.getState()
  const meta = state.sessionMetaMap.get(sessionId)
  const messageIds = new Set((state.messagesMap.get(sessionId) ?? []).map(message => message.id))

  for (const messageId of messageIds) {
    if (state.passiveStreamingMessageIds.has(messageId)) {
      state.finishGeneration(messageId)
    }
  }
  state.setPassiveStreamingMessageIds(sessionId, [])
  state.setSessionMeta(sessionId, {
    cancelling: meta?.cancelling && meta.locallyDriving,
    passiveStatus: 'idle',
  })
}
