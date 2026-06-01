import type { UIMessage } from 'ai'

import type { ChatSkillContextPart } from './chat-context-parts'
import { isChatSkillContextPart } from './chat-context-parts'
import type { ToolUiKind } from './tool-ui-classifier'

export type MessagePart = UIMessage['parts'][number]
export type FileMessagePart = Extract<MessagePart, { type: 'file' }>

export interface ToolCallItemRef {
  key: string
  messageId: string
  toolCallId: string
}

export interface MessagePartRefBase {
  key: string
  messageId: string
  partIndex: number
}

export type ChatRenderSegment
  = | (MessagePartRefBase & { kind: 'text', hasText: boolean })
    | (MessagePartRefBase & { kind: 'reasoning' })
    | { kind: 'tool-call', messageId: string, toolCallId: string, key: string }
    | { kind: 'tool-group', items: ToolCallItemRef[], uiKind: ToolUiKind, key: string }
    | (MessagePartRefBase & { kind: 'skill-context' })
    | (MessagePartRefBase & { kind: 'file-attachment' })

export type ChatRenderItem
  = | { kind: 'text', text: string, key: string }
    | { kind: 'reasoning', text: string, state?: 'streaming' | 'done', key: string }
    | { kind: 'tool-call', messageId: string, toolCallId: string, key: string }
    | { kind: 'tool-group', items: ToolCallItemRef[], uiKind: ToolUiKind, key: string }
    | { kind: 'skill-context', part: ChatSkillContextPart, key: string }
    | { kind: 'file-attachment', part: FileMessagePart, key: string }

export interface ExecutionPhaseSplit {
  executionItems: ChatRenderItem[]
  finalItems: ChatRenderItem[]
}

export interface SegmentExecutionPhaseSplit {
  executionItems: ChatRenderSegment[]
  finalItems: ChatRenderSegment[]
}

export interface GroupMessagePartsInput {
  parts: MessagePart[]
  messageId: string
  describeToolKind: (toolCallId: string) => ToolUiKind | null
}

export function groupMessagePartRefs(input: GroupMessagePartsInput): ChatRenderSegment[] {
  const items: ChatRenderSegment[] = []

  for (let i = 0; i < input.parts?.length; i++) {
    const part = input.parts[i]
    const key = 'toolCallId' in part
      ? (part as { toolCallId: string }).toolCallId
      : `${input.messageId}-${part.type}-${i}`

    if (part.type === 'text') {
      items.push({
        kind: 'text',
        key,
        messageId: input.messageId,
        partIndex: i,
        hasText: part.text.trim().length > 0,
      })
    }
    else if (part.type === 'reasoning') {
      items.push({
        kind: 'reasoning',
        key,
        messageId: input.messageId,
        partIndex: i,
      })
    }
    else if (part.type === 'file') {
      items.push({
        kind: 'file-attachment',
        key,
        messageId: input.messageId,
        partIndex: i,
      })
    }
    else if (isChatSkillContextPart(part)) {
      items.push({
        kind: 'skill-context',
        key,
        messageId: input.messageId,
        partIndex: i,
      })
    }
    else if (part.type === 'dynamic-tool' || (part.type.startsWith('tool-') && 'toolCallId' in part)) {
      const toolCallId = (part as { toolCallId: string }).toolCallId
      items.push({ kind: 'tool-call', messageId: input.messageId, toolCallId, key })
    }
  }

  return groupConsecutiveToolCalls(items, input.describeToolKind)
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
    else if (isChatSkillContextPart(part)) {
      items.push({ kind: 'skill-context', part, key })
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
): ChatRenderItem[]
function groupConsecutiveToolCalls(
  items: ChatRenderSegment[],
  describeToolKind: (toolCallId: string) => ToolUiKind | null,
): ChatRenderSegment[]
function groupConsecutiveToolCalls(
  items: Array<ChatRenderItem | ChatRenderSegment>,
  describeToolKind: (toolCallId: string) => ToolUiKind | null,
): Array<ChatRenderItem | ChatRenderSegment> {
  const result: Array<ChatRenderItem | ChatRenderSegment> = []
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
      const nextItem = items[j] as Extract<ChatRenderItem | ChatRenderSegment, { kind: 'tool-call' }>
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

export function splitSegmentExecutionPhase(items: ChatRenderSegment[]): SegmentExecutionPhaseSplit | null {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (item.kind !== 'text' || !item.hasText) {
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
