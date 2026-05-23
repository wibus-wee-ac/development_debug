// Output: Shared enabled-state indicator for Agent Management rows.
// Input: A compact tone value from agent or provider enabled state.
// Position: Agent Management owns list-row status presentation across settings views.

import { cn } from '~/lib/cn'

export function StatusDot({ tone }: { tone: 'active' | 'muted' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-2 shrink-0 rounded-full',
        tone === 'active' ? 'bg-emerald-500' : 'bg-muted-foreground/45'
      )}
    />
  )
}
