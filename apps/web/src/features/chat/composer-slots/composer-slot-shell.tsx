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
        'pointer-events-auto relative z-0 mx-2 -mb-px max-w-full overflow-hidden rounded-t-lg rounded-b-none px-3 py-1.5 text-xs text-muted-foreground',
        'border border-border border-b-0 shadow-[0_-8px_24px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.45)] backdrop-blur',
        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-150',
        'dark:shadow-[0_-8px_24px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.08)]',
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
