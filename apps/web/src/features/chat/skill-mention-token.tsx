/**
 * Output: Shared inline Skill mention token presentation for chat composer and message bubbles.
 * Input: Skill name plus optional class overrides.
 * Position: Chat feature owns Cradle-selected Skill token UI under the data-cradle-skill context namespace.
 */

import { cn } from '~/lib/cn'

export const SKILL_MENTION_TOKEN_CLASS = 'inline-flex max-w-full items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 align-baseline text-[0.8125em] font-medium leading-none text-primary ring-1 ring-primary/15'

export function formatSkillMentionTokenLabel(name: string): string {
  return `$${name}`
}

export function SkillMentionToken({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  return (
    <span className={cn(SKILL_MENTION_TOKEN_CLASS, className)}>
      {formatSkillMentionTokenLabel(name)}
    </span>
  )
}
