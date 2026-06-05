import type { UIMessage } from 'ai'

import type { ChatContextPart } from './chat-context-parts'
import { toOrderedUserMessageParts } from './chat-context-parts'
import type { ChatContinuationMode, ChatQueueItem } from './chat-response-command'

export interface ChatContinuationMetadata {
  mode: ChatContinuationMode
  queueItemId?: string
  sourceMessageId?: string
  splitParts?: UIMessage['parts']
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function readChatContinuationMetadata(message: UIMessage): ChatContinuationMetadata | null {
  const metadata = readRecord((message as { metadata?: unknown }).metadata)
  const cradle = readRecord(metadata?.cradle)
  const continuation = readRecord(cradle?.continuation)
  if (!continuation) {
    return null
  }
  const mode = continuation?.mode

  if (mode !== 'queue' && mode !== 'steer') {
    return null
  }

  const queueItemId = continuation.queueItemId
  const sourceMessageId = continuation.sourceMessageId
  const splitParts = readMessageParts(continuation.splitParts)
  return {
    mode,
    ...(typeof queueItemId === 'string' && queueItemId.length > 0 ? { queueItemId } : {}),
    ...(typeof sourceMessageId === 'string' && sourceMessageId.length > 0 ? { sourceMessageId } : {}),
    ...(splitParts ? { splitParts } : {}),
  }
}

function readMessageParts(value: unknown): UIMessage['parts'] | null {
  if (
    !Array.isArray(value)
    || !value.every(part => typeof part === 'object' && part !== null && !Array.isArray(part) && typeof (part as { type?: unknown }).type === 'string')
  ) {
    return null
  }

  return value as UIMessage['parts']
}

export function createContinuationUserMessage(input: {
  queueItem: ChatQueueItem
  fallbackText: string
  fallbackContextParts: ChatContextPart[]
  fallbackFiles: UIMessage['parts']
}): UIMessage {
  const text = input.queueItem.text || input.fallbackText
  const contextParts = input.queueItem.contextParts.length > 0 ? input.queueItem.contextParts : input.fallbackContextParts
  const files = input.queueItem.files.length > 0 ? input.queueItem.files : input.fallbackFiles
  const parts = toOrderedUserMessageParts(text, contextParts) as UIMessage['parts']
  parts.push(...files)

  return {
    id: `continuation-${input.queueItem.id}`,
    role: 'user',
    parts,
    metadata: {
      cradle: {
        continuation: {
          mode: input.queueItem.mode,
          queueItemId: input.queueItem.id,
        },
      },
    },
  } as UIMessage
}
