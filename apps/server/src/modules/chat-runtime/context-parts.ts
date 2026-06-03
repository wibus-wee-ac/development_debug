import type { UIMessage } from 'ai'

export type ChatContextPart = ChatSkillContextPart

export interface ChatSkillContextPart {
  type: 'data-cradle-skill'
  name: string
  path: string
  scope: 'builtin' | 'legacy' | 'global' | 'repository' | 'workspace' | 'agent'
  description: string | null
  position?: number
}

type MessagePart = UIMessage['parts'][number]
type CradleSkillMessagePart = MessagePart & {
  type: 'data-cradle-skill'
  data: ChatSkillContextPart
}

function readSkillPayload(part: unknown): ChatSkillContextPart | null {
  if (!part || typeof part !== 'object') {
    return null
  }
  const record = part as { type?: unknown, data?: unknown }
  if (record.type !== 'data-cradle-skill') {
    return null
  }
  const data = record.data && typeof record.data === 'object'
    ? record.data as { type?: unknown, name?: unknown, path?: unknown, scope?: unknown, description?: unknown, position?: unknown }
    : null
  if (
    data?.type !== 'data-cradle-skill'
    || typeof data.name !== 'string'
    || typeof data.path !== 'string'
  ) {
    return null
  }
  return data as ChatSkillContextPart
}

export function isChatSkillContextPart(part: MessagePart | unknown): part is CradleSkillMessagePart {
  return readSkillPayload(part) !== null
}

export function readChatSkillContextPart(part: MessagePart | unknown): ChatSkillContextPart | null {
  return readSkillPayload(part)
}

export function toMessageParts(parts: ChatContextPart[] | undefined): MessagePart[] {
  return (parts ?? []).map(part => ({
    type: part.type,
    data: part,
  } as CradleSkillMessagePart))
}

export function toOrderedUserMessageParts(text: string, contextParts: ChatContextPart[] | undefined, sourceText = text): MessagePart[] {
  const parts = contextParts ?? []
  if (parts.length === 0) {
    return text ? [{ type: 'text', text } as MessagePart] : []
  }

  const leadingTrim = sourceText.length - sourceText.trimStart().length
  const sortedParts = [...parts].sort((left, right) => (left.position ?? sourceText.length) - (right.position ?? sourceText.length))
  const messageParts: MessagePart[] = []
  let offset = 0

  for (const contextPart of sortedParts) {
    const position = typeof contextPart.position === 'number'
      ? Math.max(0, Math.min(text.length, contextPart.position - leadingTrim))
      : text.length
    if (position > offset) {
      messageParts.push({ type: 'text', text: text.slice(offset, position) } as MessagePart)
    }
    messageParts.push({
      type: contextPart.type,
      data: contextPart,
    } as CradleSkillMessagePart)
    offset = position
  }

  if (offset < text.length) {
    messageParts.push({ type: 'text', text: text.slice(offset) } as MessagePart)
  }

  return messageParts
}

export function describeChatContextPart(part: ChatContextPart): string {
  if (part.type === 'data-cradle-skill') {
    return `skill ${part.name}`
  }
  return part.type
}
