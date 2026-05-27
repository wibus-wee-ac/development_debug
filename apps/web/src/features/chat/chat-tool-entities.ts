import type { UIMessage } from 'ai'

import type { ToolState } from './tool-ui-classifier'

const TOOL_TYPE_PREFIX_PATTERN = /^tool-/

type MessagePart = UIMessage['parts'][number]

export interface ToolAnchorPart {
  type: 'dynamic-tool'
  toolCallId: string
  toolName: string
  state: ToolState
}

export interface ChatToolEntity {
  toolCallId: string
  messageId: string
  toolName: string
  state: ToolState
  approval?: {
    id: string
    approved?: boolean
    reason?: string
  }
  preliminary?: boolean
  argumentsText?: string
  input?: unknown
  output?: unknown
  errorText?: string
}

interface SubagentToolOutput {
  type: 'cradle.subagent-output.v1'
  message: UIMessage
}

export function isToolLikePart(part: MessagePart): part is MessagePart & {
  toolCallId: string
  toolName?: string
  state?: string
  approval?: {
    id?: unknown
    approved?: unknown
    reason?: unknown
  }
  preliminary?: boolean
  argumentsText?: string
  input?: unknown
  output?: unknown
  errorText?: string
} {
  return (part.type === 'dynamic-tool' || part.type.startsWith('tool-'))
    && 'toolCallId' in part
    && typeof part.toolCallId === 'string'
}

export function toolNameFromPart(part: {
  type: string
  toolName?: string
}): string {
  return part.toolName ?? part.type.replace(TOOL_TYPE_PREFIX_PATTERN, '')
}

export function toToolAnchorPart(part: MessagePart & {
  toolCallId: string
  toolName?: string
  state?: string
}): ToolAnchorPart {
  return {
    type: 'dynamic-tool',
    toolCallId: part.toolCallId,
    toolName: toolNameFromPart(part),
    state: (part.state as ToolState | undefined) ?? 'input-streaming',
  }
}

export function toToolEntity(messageId: string, part: MessagePart & {
  toolCallId: string
  toolName?: string
  state?: string
  approval?: {
    id?: unknown
    approved?: unknown
    reason?: unknown
  }
  preliminary?: boolean
  argumentsText?: string
  input?: unknown
  output?: unknown
  errorText?: string
}): ChatToolEntity {
  return {
    toolCallId: part.toolCallId,
    messageId,
    toolName: toolNameFromPart(part),
    state: (part.state as ToolState | undefined) ?? 'input-streaming',
    approval: readToolApproval(part.approval),
    preliminary: part.preliminary,
    argumentsText: part.argumentsText,
    input: part.input,
    output: part.output,
    errorText: part.errorText,
  }
}

function readToolApproval(approval: {
  id?: unknown
  approved?: unknown
  reason?: unknown
} | undefined): ChatToolEntity['approval'] {
  if (!approval || typeof approval.id !== 'string') {
    return undefined
  }
  return {
    id: approval.id,
    ...(typeof approval.approved === 'boolean' ? { approved: approval.approved } : {}),
    ...(typeof approval.reason === 'string' ? { reason: approval.reason } : {}),
  }
}

export function normalizeMessageForToolEntities(message: UIMessage): {
  message: UIMessage
  toolEntities: ChatToolEntity[]
} {
  return normalizeMessageForOwner(message, message.id)
}

function normalizeMessageForOwner(message: UIMessage, ownerMessageId: string): {
  message: UIMessage
  toolEntities: ChatToolEntity[]
} {
  const toolEntities: ChatToolEntity[] = []
  for (const part of message.parts) {
    if (!isToolLikePart(part)) {
      continue
    }

    toolEntities.push(toToolEntity(ownerMessageId, part))
    const subagentMessage = readSubagentOutputMessage(part.output)
    if (subagentMessage) {
      toolEntities.push(...normalizeMessageForOwner(subagentMessage, ownerMessageId).toolEntities)
    }
  }

  return {
    message,
    toolEntities,
  }
}

export function collectToolCallIdsFromMessages(messages: UIMessage[]): string[] {
  return messages.flatMap(message =>
    message.parts.flatMap(part => isToolLikePart(part) ? [part.toolCallId] : []))
}

export function readToolAnchorPart(parts: UIMessage['parts'], partIndex: number): ToolAnchorPart | null {
  const part = parts[partIndex]
  if (!part || !isToolLikePart(part)) {
    return null
  }
  return toToolAnchorPart(part)
}

export function readSubagentOutputMessage(output: unknown): UIMessage | null {
  if (!isSubagentToolOutput(output)) {
    return null
  }
  return output.message
}

function isSubagentToolOutput(output: unknown): output is SubagentToolOutput {
  return typeof output === 'object'
    && output !== null
    && (output as { type?: unknown }).type === 'cradle.subagent-output.v1'
    && isUiMessage((output as { message?: unknown }).message)
}

function isUiMessage(value: unknown): value is UIMessage {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { id?: unknown }).id === 'string'
    && ((value as { role?: unknown }).role === 'assistant' || (value as { role?: unknown }).role === 'user')
    && Array.isArray((value as { parts?: unknown }).parts)
}
