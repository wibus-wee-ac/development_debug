import type { FileUIPart } from 'ai'

import type { ChatContextPart } from './chat-context-parts'

export interface ChatPromptIngressPayload {
  text: string
  files: FileUIPart[]
  contextParts?: ChatContextPart[]
}

export type ChatPromptIngressHandler = (payload: ChatPromptIngressPayload) => void

const handlers = new Map<string, ChatPromptIngressHandler>()

export function registerChatPromptIngressHandler(
  sessionId: string,
  handler: ChatPromptIngressHandler,
): () => void {
  handlers.set(sessionId, handler)
  return () => {
    if (handlers.get(sessionId) === handler) {
      handlers.delete(sessionId)
    }
  }
}

export function submitChatPromptIngress(
  sessionId: string,
  payload: ChatPromptIngressPayload,
): boolean {
  const handler = handlers.get(sessionId)
  if (!handler) {
    return false
  }
  handler(payload)
  return true
}
