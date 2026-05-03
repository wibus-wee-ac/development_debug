// Input: status color string (hex or CSS)
// Output: StatusIcon component — solid circle indicator per status (Linear-style)
// Position: Shared UI atom for kanban column headers and issue detail

import { cn } from '@renderer/lib/cn'

interface StatusIconProps {
  color?: string | null
  className?: string
}

export function StatusIcon({ color, className }: StatusIconProps) {
  const fallback = 'var(--color-muted-foreground)'
  return (
    <span
      className={cn('inline-flex size-2 shrink-0 rounded-full', className)}
      style={{ backgroundColor: color ?? fallback }}
    />
  )
}
