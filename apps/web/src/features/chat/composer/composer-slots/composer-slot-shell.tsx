/**
 * Shared shell primitives for compact composer-adjacent runtime slots.
 */
import type { ReactNode } from 'react'

import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'

interface ComposerSlotShellProps {
  stateName: string
  testId?: string
  className?: string
  children: ReactNode
}

export function ComposerSlotShell({ stateName, testId, className, children }: ComposerSlotShellProps) {
  return (
    <div
      className={cn(
        'pointer-events-auto relative z-0 mx-1.5 -mb-px max-w-full overflow-hidden rounded-t-lg rounded-b-none bg-background px-3.5 py-2 text-xs text-muted-foreground',
        'border border-border border-b-0 shadow-sm',
        'dark:bg-background',
        className,
      )}
      data-chat-runtime-slot-state={stateName}
      data-testid={testId}
    >
      <div className="pointer-events-none absolute inset-x-4 bottom-0 h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />
      {children}
    </div>
  )
}

export function ComposerSlotIconAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="flex size-5 items-center justify-center rounded-sm text-muted-foreground/75 transition-[background-color,color,opacity,transform] hover:bg-muted hover:text-foreground active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
