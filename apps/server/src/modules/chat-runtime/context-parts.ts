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

export function isChatSkillContextPart(part: MessagePart | unknown): part is ChatSkillContextPart & MessagePart {
  return Boolean(part)
    && typeof part === 'object'
    && (part as { type?: unknown }).type === 'data-cradle-skill'
    && typeof (part as { name?: unknown }).name === 'string'
    && typeof (part as { path?: unknown }).path === 'string'
}

export function toMessageParts(parts: ChatContextPart[] | undefined): MessagePart[] {
  return (parts ?? []).map(part => part as MessagePart)
}

export function describeChatContextPart(part: ChatContextPart): string {
  if (part.type === 'data-cradle-skill') {
    return `skill ${part.name}`
  }
  return part.type
}
