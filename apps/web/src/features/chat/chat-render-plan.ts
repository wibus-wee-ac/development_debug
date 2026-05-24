import type { UIMessage } from 'ai'

import type { ToolUiKind } from './tool-ui-classifier'

export type MessagePart = UIMessage['parts'][number]
export type FileMessagePart = Extract<MessagePart, { type: 'file' }>

export interface ToolCallItemRef {
  key: string
  messageId: string
  toolCallId: string
}

export type ChatRenderItem
  = | { kind: 'text', text: string, key: string }
    | { kind: 'reasoning', text: string, state?: 'streaming' | 'done', key: string }
    | { kind: 'tool-call', messageId: string, toolCallId: string, key: string }
    | { kind: 'tool-group', items: ToolCallItemRef[], uiKind: ToolUiKind, key: string }
    | { kind: 'file-attachment', part: FileMessagePart, key: string }

export interface ExecutionPhaseSplit {
  executionItems: ChatRenderItem[]
  finalItems: ChatRenderItem[]
}

export interface GroupMessagePartsInput {
  parts: MessagePart[]
  messageId: string
  describeToolKind: (toolCallId: string) => ToolUiKind | null
}

export function groupMessageParts(input: GroupMessagePartsInput): ChatRenderItem[] {
  const items: ChatRenderItem[] = []

  for (let i = 0; i < input.parts?.length; i++) {
    const part = input.parts[i]
    const key = 'toolCallId' in part
      ? (part as { toolCallId: string }).toolCallId
      : `${input.messageId}-${part.type}-${i}`

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
      const toolCallId = (part as { toolCallId: string }).toolCallId
      items.push({ kind: 'tool-call', messageId: input.messageId, toolCallId, key })
    }
  }

  return groupConsecutiveToolCalls(items, input.describeToolKind)
}

const GROUPABLE_KINDS = new Set<ToolUiKind>(['terminal', 'file-read', 'search', 'file-diff'])

function groupConsecutiveToolCalls(
  items: ChatRenderItem[],
  describeToolKind: (toolCallId: string) => ToolUiKind | null,
): ChatRenderItem[] {
  const result: ChatRenderItem[] = []
  let i = 0
  while (i < items.length) {
    const item = items[i]
    if (item.kind !== 'tool-call') {
      result.push(item)
      i++
      continue
    }
    const uiKind = describeToolKind(item.toolCallId)
    if (!uiKind || !GROUPABLE_KINDS.has(uiKind)) {
      result.push(item)
      i++
      continue
    }
    const group: ToolCallItemRef[] = [{ key: item.key, messageId: item.messageId, toolCallId: item.toolCallId }]
    let j = i + 1
    while (j < items.length && items[j].kind === 'tool-call') {
      const nextItem = items[j] as Extract<ChatRenderItem, { kind: 'tool-call' }>
      if (describeToolKind(nextItem.toolCallId) !== uiKind) {
        break
      }
      group.push({ key: nextItem.key, messageId: nextItem.messageId, toolCallId: nextItem.toolCallId })
      j++
    }
    if (group.length >= 2) {
      result.push({
        kind: 'tool-group',
        items: group,
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
