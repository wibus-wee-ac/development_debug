// Input: label string
// Output: Compact colored label chip
// Position: Shared display component for issue labels

import { cn } from '~/lib/cn'

export function LabelChip({ label, className }: { label: string, className?: string }) {
  return (
    <span className={cn(
      'inline-flex items-center px-1.5 h-4 rounded text-[11px]',
      'bg-muted text-muted-foreground',
      className,
    )}>
      {label}
    </span>
  )
}
