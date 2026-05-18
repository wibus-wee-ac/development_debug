// Input: UIMessage parts and subagent message buckets
// Output: Pure render-plan helpers for MessageBubble
// Position: Chat rendering adapter between AI SDK message parts and React block components

import type { UIMessage } from 'ai'

import type { RenderableToolPart } from './tool-ui-classifier'

export type MessagePart = UIMessage['parts'][number]

export type ChatRenderItem
  = | { kind: 'text', text: string, key: string }
    | { kind: 'reasoning', text: string, state?: 'streaming' | 'done', key: string }
    | { kind: 'tool-call', part: RenderableToolPart, subagentMessages: UIMessage[], key: string }
    | { kind: 'file-attachment', key: string }

export interface ExecutionPhaseSplit {
  executionItems: ChatRenderItem[]
  finalItems: ChatRenderItem[]
}

export function groupMessageParts(
  parts: MessagePart[],
  messageId: string,
  subagentMap: Map<string, UIMessage[]> | undefined,
): ChatRenderItem[] {
  const items: ChatRenderItem[] = []

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    const key = 'toolCallId' in part
      ? (part as { toolCallId: string }).toolCallId
      : `${messageId}-${part.type}-${i}`

    if (part.type === 'text') {
      items.push({ kind: 'text', text: part.text, key })
    }
    else if (part.type === 'reasoning') {
      items.push({
        kind: 'reasoning',
        text: part.text,
        state: (part as { state?: 'streaming' | 'done' }).state,
        key,
      })
    }
    else if (part.type === 'file') {
      items.push({ kind: 'file-attachment', key })
    }
    else if (part.type === 'dynamic-tool' || (part.type.startsWith('tool-') && 'toolCallId' in part)) {
      const toolPart = part as RenderableToolPart
      const subagentMessages = subagentMap?.get(toolPart.toolCallId) ?? []
      items.push({ kind: 'tool-call', part: toolPart, subagentMessages, key })
    }
  }

  return items
}

export function hasFinalReply(items: ChatRenderItem[]): boolean {
  return splitExecutionPhase(items) !== null
}

export function splitExecutionPhase(items: ChatRenderItem[]): ExecutionPhaseSplit | null {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (item.kind !== 'text' || item.text.trim().length === 0) {
      continue
    }

    const hasToolBeforeFinalText = items
      .slice(0, index)
      .some(candidate => candidate.kind === 'tool-call')

    if (!hasToolBeforeFinalText) {
      continue
    }

    return {
      executionItems: items.slice(0, index),
      finalItems: items.slice(index),
    }
  }

  return null
}
