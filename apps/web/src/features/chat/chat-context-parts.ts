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

export function isChatSkillContextPart(part: unknown): part is ChatSkillContextPart {
  return Boolean(part)
    && typeof part === 'object'
    && (part as { type?: unknown }).type === 'data-cradle-skill'
    && typeof (part as { name?: unknown }).name === 'string'
    && typeof (part as { path?: unknown }).path === 'string'
}

export function readSkillContextLabel(part: ChatSkillContextPart): string {
  return part.name
}
