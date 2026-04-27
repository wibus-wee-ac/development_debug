// Input: status color string (hex or CSS)
// Output: StatusIcon component — circle indicator per status (Linear-style)
// Position: Shared UI atom for kanban column headers and issue detail

import { cn } from '@renderer/lib/cn'

interface StatusIconProps {
  color?: string | null
  className?: string
}

export function StatusIcon({ color, className }: StatusIconProps) {
  return (
    <span
      className={cn('inline-flex size-3.5 shrink-0 items-center justify-center', className)}
    >
      <span
        className="size-2.5 rounded-full border-[1.5px]"
        style={{ borderColor: color ?? 'var(--color-muted-foreground)' }}
      />
    </span>
  )
}
