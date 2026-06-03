import type { SkillScope } from '~/lib/types'

export interface ChatSkillContextPart {
  type: 'data-cradle-skill'
  name: string
  path: string
  scope: SkillScope
  description: string | null
  position?: number
}

export type ChatContextPart = ChatSkillContextPart
export type ChatSkillContextMessagePart = {
  type: 'data-cradle-skill'
  data: ChatSkillContextPart
}

function readSkillContextPayload(part: unknown): ChatSkillContextPart | null {
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

export function isChatSkillContextPart(part: unknown): part is ChatSkillContextMessagePart {
  return readSkillContextPayload(part) !== null
}

export function readSkillContextPart(part: unknown): ChatSkillContextPart | null {
  return readSkillContextPayload(part)
}

export function toMessageContextParts(parts: ChatContextPart[]): ChatSkillContextMessagePart[] {
  return parts.map(part => ({
    type: part.type,
    data: part,
  }))
}

export function toOrderedUserMessageParts(
  text: string,
  contextParts: ChatContextPart[],
  sourceText = text,
): ChatSkillContextMessagePart[] | Array<ChatSkillContextMessagePart | { type: 'text', text: string }> {
  if (contextParts.length === 0) {
    return text ? [{ type: 'text', text }] : []
  }

  const leadingTrim = sourceText.length - sourceText.trimStart().length
  const sortedParts = [...contextParts].sort((left, right) => (left.position ?? sourceText.length) - (right.position ?? sourceText.length))
  const parts: Array<ChatSkillContextMessagePart | { type: 'text', text: string }> = []
  let offset = 0

  for (const contextPart of sortedParts) {
    const position = typeof contextPart.position === 'number'
      ? Math.max(0, Math.min(text.length, contextPart.position - leadingTrim))
      : text.length
    if (position > offset) {
      parts.push({ type: 'text', text: text.slice(offset, position) })
    }
    parts.push({ type: contextPart.type, data: contextPart })
    offset = position
  }

  if (offset < text.length) {
    parts.push({ type: 'text', text: text.slice(offset) })
  }

  return parts
}

export function readSkillContextLabel(part: ChatSkillContextPart): string {
  return part.name
}
