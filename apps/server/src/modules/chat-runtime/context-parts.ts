/**
 * Output: Chat Runtime-owned structured context part helpers.
 * Input: Cradle UI message parts and HTTP context part payloads.
 * Position: Runtime boundary between Cradle composer tokens and provider adapters.
 */

import type { UIMessage } from 'ai'

export type ChatContextPart = ChatSkillContextPart

export interface ChatSkillContextPart {
  type: 'data-cradle-skill'
  name: string
  path: string
  scope: 'builtin' | 'legacy' | 'global' | 'repository' | 'workspace' | 'agent'
  description: string | null
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

export function isChatSkillContextPart(part: MessagePart | unknown): part is ChatSkillContextPart & MessagePart {
  return readSkillPayload(part) !== null
}

export function toMessageParts(parts: ChatContextPart[] | undefined): MessagePart[] {
  return (parts ?? []).map(part => ({
    type: part.type,
    data: part,
  } as CradleSkillMessagePart))
}

export function describeChatContextPart(part: ChatContextPart): string {
  if (part.type === 'data-cradle-skill') {
    return `skill ${part.name}`
  }
  return part.type
}
