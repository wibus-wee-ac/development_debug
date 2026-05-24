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
  argumentsText?: string
  input?: unknown
  output?: unknown
  errorText?: string
}

export function isToolLikePart(part: MessagePart): part is MessagePart & {
  toolCallId: string
  toolName?: string
  state?: string
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
    argumentsText: part.argumentsText,
    input: part.input,
    output: part.output,
    errorText: part.errorText,
  }
}

export function normalizeMessageForToolEntities(message: UIMessage): {
  message: UIMessage
  toolEntities: ChatToolEntity[]
} {
  const toolEntities: ChatToolEntity[] = []
  const parts = message.parts.map((part) => {
    if (!isToolLikePart(part)) {
      return part
    }

    toolEntities.push(toToolEntity(message.id, part))
    return toToolAnchorPart(part) as unknown as MessagePart
  })

  return {
    message: {
      ...message,
      parts,
    },
    toolEntities,
  }
}

export function collectToolCallIdsFromMessages(messages: UIMessage[]): string[] {
  return messages.flatMap(message =>
    message.parts.flatMap(part => isToolLikePart(part) ? [part.toolCallId] : []))
}

export function collectToolCallIdsFromSubagentMap(messageMap: Map<string, UIMessage[]>): string[] {
  const toolCallIds: string[] = []
  for (const messages of messageMap.values()) {
    toolCallIds.push(...collectToolCallIdsFromMessages(messages))
  }
  return toolCallIds
}

export function readToolAnchorPart(parts: UIMessage['parts'], partIndex: number): ToolAnchorPart | null {
  const part = parts[partIndex]
  if (!part || !isToolLikePart(part)) {
    return null
  }
  return toToolAnchorPart(part)
}
