import type { FileUIPart, UIMessage } from 'ai'

import type { ChatContextPart } from './context-parts'
import { isChatSkillContextPart, readChatSkillContextPart, toOrderedUserMessageParts } from './context-parts'

export function parseStoredMessageSnapshot(raw: string): UIMessage {
  return normalizeMessageSnapshot(JSON.parse(raw) as UIMessage)
}

export function normalizeMessageSnapshot(message: UIMessage): UIMessage {
  if (message.role !== 'user' || !message.parts.some(part => isChatSkillContextPart(part) && typeof readChatSkillContextPart(part)?.position === 'number')) {
    return message
  }

  const text = message.parts
    .flatMap(part => part.type === 'text' ? [part.text] : [])
    .join('')
  const contextParts = message.parts.flatMap((part) => {
    const contextPart = readChatSkillContextPart(part)
    return contextPart ? [contextPart] : []
  })
  const orderedParts = toOrderedUserMessageParts(text, contextParts) as UIMessage['parts']
  orderedParts.push(...message.parts.filter(part => part.type !== 'text' && !isChatSkillContextPart(part)))

  return {
    ...message,
    parts: orderedParts,
  }
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

export function annotateCodexGoalContinuationMessage(message: UIMessage): UIMessage {
  const metadata = readRecord((message as { metadata?: unknown }).metadata)
  const cradleMetadata = readRecord(metadata.cradle)
  const codexMetadata = readRecord(cradleMetadata.codex)
  return {
    ...message,
    metadata: {
      ...metadata,
      cradle: {
        ...cradleMetadata,
        codex: {
          ...codexMetadata,
          goalContinuation: true,
        },
      },
    },
  } as UIMessage
}

export function isCodexGoalContinuationMessage(message: UIMessage): boolean {
  const metadata = readRecord((message as { metadata?: unknown }).metadata)
  const cradleMetadata = readRecord(metadata.cradle)
  const codexMetadata = readRecord(cradleMetadata.codex)
  return codexMetadata.goalContinuation === true
}

export function extractMessageText(message: UIMessage): string {
  const parsedMessage = normalizeMessageSnapshot(message)
  return parsedMessage.parts
    .flatMap(part => part.type === 'text' ? [part.text] : [])
    .join('')
}
