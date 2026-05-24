import type { UIMessage } from 'ai'

import type { RenderableToolPart, ToolUiKind } from './tool-ui-classifier'
import { describeToolCall } from './tool-ui-classifier'

export type MessagePart = UIMessage['parts'][number]
export type FileMessagePart = Extract<MessagePart, { type: 'file' }>

export interface ToolCallItem {
  part: RenderableToolPart
  subagentMessages: UIMessage[]
  key: string
}

export type ChatRenderItem
  = | { kind: 'text', text: string, key: string }
    | { kind: 'reasoning', text: string, state?: 'streaming' | 'done', key: string }
    | { kind: 'tool-call', part: RenderableToolPart, subagentMessages: UIMessage[], key: string }
    | { kind: 'tool-group', items: ToolCallItem[], uiKind: ToolUiKind, key: string }
    | { kind: 'file-attachment', part: FileMessagePart, key: string }

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
      items.push({ kind: 'file-attachment', part, key })
    }
    else if (part.type === 'dynamic-tool' || (part.type.startsWith('tool-') && 'toolCallId' in part)) {
      const toolPart = part as RenderableToolPart
      const subagentMessages = subagentMap?.get(toolPart.toolCallId) ?? []
      items.push({ kind: 'tool-call', part: toolPart, subagentMessages, key })
    }
  }

  return groupConsecutiveToolCalls(items)
}

const GROUPABLE_KINDS = new Set<ToolUiKind>(['terminal', 'file-read', 'search', 'file-diff'])

function groupConsecutiveToolCalls(items: ChatRenderItem[]): ChatRenderItem[] {
  const result: ChatRenderItem[] = []
  let i = 0
  while (i < items.length) {
    const item = items[i]
    if (item.kind !== 'tool-call') {
      result.push(item)
      i++
      continue
    }
    const uiKind = describeToolCall(item.part).kind
    if (!GROUPABLE_KINDS.has(uiKind)) {
      result.push(item)
      i++
      continue
    }
    const group: Array<{ kind: 'tool-call', part: RenderableToolPart, subagentMessages: UIMessage[], key: string }> = [item]
    let j = i + 1
    while (j < items.length && items[j].kind === 'tool-call') {
      const nextItem = items[j] as { kind: 'tool-call', part: RenderableToolPart, subagentMessages: UIMessage[], key: string }
      if (describeToolCall(nextItem.part).kind !== uiKind) {
        break
      }
      group.push(nextItem)
      j++
    }
    if (group.length >= 2) {
      result.push({
        kind: 'tool-group',
        items: group.map(g => ({ part: g.part, subagentMessages: g.subagentMessages, key: g.key })),
        uiKind,
        key: group[0].key,
      })
      i = j
    }
    else {
      result.push(item)
      i++
    }
  }
  return result
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
      .some(candidate => candidate.kind === 'tool-call' || candidate.kind === 'tool-group')

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
