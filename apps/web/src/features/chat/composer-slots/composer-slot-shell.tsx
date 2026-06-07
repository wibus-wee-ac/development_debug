/**
 * Shared shell primitives for compact composer-adjacent runtime slots.
 */
import { m, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'

import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'

interface ComposerSlotShellProps {
  stateName: string
  testId?: string
  className?: string
  children: ReactNode
}

const COMPOSER_SLOT_LAYOUT_TRANSITION = { type: 'spring', stiffness: 520, damping: 42, mass: 0.85 } as const
const COMPOSER_SLOT_CONTENT_ENTER_TRANSITION = { type: 'spring', stiffness: 620, damping: 34, mass: 0.72 } as const
const COMPOSER_SLOT_CONTENT_EXIT_TRANSITION = { type: 'spring', stiffness: 500, damping: 38, mass: 0.82 } as const
const COMPOSER_SLOT_REDUCED_TRANSITION = { duration: 0 } as const

export function ComposerSlotShell({ stateName, testId, className, children }: ComposerSlotShellProps) {
  const shouldReduceMotion = useReducedMotion()
  const hiddenState = shouldReduceMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 18, filter: 'blur(2px)' }
  const visibleState = shouldReduceMotion
    ? { opacity: 1 }
    : { opacity: 1, y: 0, filter: 'blur(0px)' }

  return (
    <m.div
      initial={{ height: 0 }}
      animate={{ height: 'auto' }}
      exit={{ height: 0 }}
      transition={shouldReduceMotion ? COMPOSER_SLOT_REDUCED_TRANSITION : COMPOSER_SLOT_LAYOUT_TRANSITION}
      className="overflow-hidden"
    >
      <m.div
        initial={hiddenState}
        animate={{
          ...visibleState,
          transition: shouldReduceMotion ? COMPOSER_SLOT_REDUCED_TRANSITION : COMPOSER_SLOT_CONTENT_ENTER_TRANSITION,
        }}
        exit={{
          ...hiddenState,
          transition: shouldReduceMotion ? COMPOSER_SLOT_REDUCED_TRANSITION : COMPOSER_SLOT_CONTENT_EXIT_TRANSITION,
        }}
        className={cn(
          'pointer-events-auto relative z-0 mx-2 -mb-px max-w-full transform-gpu overflow-hidden rounded-t-lg rounded-b-none bg-background/70 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-xl',
          'border border-border border-b-0 shadow-[0_-8px_24px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.45)]',
          'dark:bg-background/80 dark:shadow-[0_-8px_24px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.08)]',
          className,
        )}
        data-chat-runtime-slot-state={stateName}
        data-testid={testId}
      >
        <div className="pointer-events-none absolute inset-x-4 bottom-0 h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />
        {children}
      </m.div>
    </m.div>
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
