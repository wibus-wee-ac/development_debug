import type { FileUIPart, UIMessage } from 'ai'

import { toOrderedUserMessageParts, type ChatContextPart } from './context-parts'

export function parseStoredMessageSnapshot(raw: string): UIMessage {
  return JSON.parse(raw) as UIMessage
}

export function normalizeMessageSnapshot(message: UIMessage): UIMessage {
  return message
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function createAssistantMessage(messageId: string, parts: UIMessage['parts'] = []): UIMessage {
  return {
    id: messageId,
    role: 'assistant',
    parts,
  }
}

export function createUserMessage(messageId: string, text: string, files: FileUIPart[] = [], contextParts: ChatContextPart[] = []): UIMessage {
  const parts = toOrderedUserMessageParts(text, contextParts) as UIMessage['parts']
  parts.push(...files)

  return {
    id: messageId,
    role: 'user',
    parts,
  }
}

export function annotateGoalMessage(message: UIMessage, objective: string): UIMessage {
  const metadata = readRecord((message as { metadata?: unknown }).metadata)
  const cradleMetadata = readRecord(metadata.cradle)
  return {
    ...message,
    metadata: {
      ...metadata,
      cradle: {
        ...cradleMetadata,
        goal: { objective },
      },
    },
  } as UIMessage
}

export function readGoalMessageObjective(message: UIMessage): string | null {
  const metadata = readRecord((message as { metadata?: unknown }).metadata)
  const cradleMetadata = readRecord(metadata.cradle)
  const goal = readRecord(cradleMetadata.goal)
  return typeof goal.objective === 'string' && goal.objective.trim().length > 0
    ? goal.objective.trim()
    : null
}

export function extractMessageText(message: UIMessage): string {
  const parsedMessage = normalizeMessageSnapshot(message)
  return parsedMessage.parts
    .flatMap(part => part.type === 'text' ? [part.text] : [])
    .join('')
}
