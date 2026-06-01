import type { FileUIPart, UIMessage } from 'ai'

import type { ChatContextPart } from './context-parts'

export function parseStoredMessageSnapshot(raw: string): UIMessage {
  return JSON.parse(raw) as UIMessage
}

export function normalizeMessageSnapshot(message: UIMessage): UIMessage {
  return message
}

export function createAssistantMessage(messageId: string, parts: UIMessage['parts'] = []): UIMessage {
  return {
    id: messageId,
    role: 'assistant',
    parts,
  }
}

export function createUserMessage(messageId: string, text: string, files: FileUIPart[] = [], contextParts: ChatContextPart[] = []): UIMessage {
  const parts: UIMessage['parts'] = text ? [{ type: 'text', text }] : []
  parts.push(...contextParts as UIMessage['parts'])
  parts.push(...files)

  return {
    id: messageId,
    role: 'user',
    parts,
  }
}

export function extractMessageText(message: UIMessage): string {
  const parsedMessage = normalizeMessageSnapshot(message)
  return parsedMessage.parts
    .flatMap(part => part.type === 'text' ? [part.text] : [])
    .join('')
}
