// Output: Chat composer-owned structured context parts for runtime adapter projection.
// Input: UI-selected context tokens such as Skills.
// Position: Feature/chat boundary between composer UI and chat send transport.

import type { SkillScope } from '~/lib/types'

export interface ChatSkillContextPart {
  type: 'data-cradle-skill'
  name: string
  path: string
  scope: SkillScope
  description: string | null
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
    ? record.data as { type?: unknown, name?: unknown, path?: unknown, scope?: unknown, description?: unknown }
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

export function isChatSkillContextPart(part: unknown): part is ChatSkillContextPart {
  return readSkillContextPayload(part) !== null
}

export function readSkillContextPart(part: ChatSkillContextPart | ChatSkillContextMessagePart): ChatSkillContextPart {
  return 'data' in part ? part.data : part
}

export function toMessageContextParts(parts: ChatContextPart[]): ChatSkillContextMessagePart[] {
  return parts.map(part => ({
    type: part.type,
    data: part,
  }))
}

export function readSkillContextLabel(part: ChatSkillContextPart): string {
  return part.name
}
