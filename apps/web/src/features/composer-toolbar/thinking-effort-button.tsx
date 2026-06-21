import type { KeyboardEvent, PointerEvent } from 'react'
import { useRef, useState } from 'react'
import type { Transition } from 'motion/react'
import { m, useReducedMotion } from 'motion/react'

import { BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS } from '~/features/browser/native-surface-occlusion'
import { cn } from '~/lib/cn'

import type { ThinkingOption } from './provider-model-menu'
import type { ThinkingEffort } from './types'

type ConcreteEffort = NonNullable<ThinkingEffort>
type Mode = 'idle' | 'dragging'

const LONG_PRESS_MS = 180
const DRAG_START_THRESHOLD_PX = 8
const SEGMENT_WIDTH = 20
const STRIP_PADDING_X = 2
const MATRIX_DOT_COUNT = 6
const MATRIX_DOTS = Array.from({ length: MATRIX_DOT_COUNT }, (_, index) => index)

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(length - 1, index))
}

export function ThinkingEffortButton({
  thinkingEffort,
  thinkingOptions,
  onSelect,
  occludeNativeBrowserSurface,
}: {
  thinkingEffort: ThinkingEffort
  thinkingOptions: Array<ThinkingOption<ThinkingEffort>>
  onSelect: (effort: ThinkingEffort) => void
  occludeNativeBrowserSurface?: boolean
}) {
  const reduceMotion = useReducedMotion()
  const tiers = thinkingOptions.filter((option): option is ThinkingOption<ConcreteEffort> => option.value !== null)

  const selectedIndex = tiers.findIndex(option => option.value === thinkingEffort)
  const currentIndex = selectedIndex === -1 ? 0 : selectedIndex
  const [mode, setMode] = useState<Mode>('idle')
  const [dragIndex, setDragIndex] = useState(currentIndex)
  const activeIndex = mode === 'dragging' ? dragIndex : currentIndex

  const active = tiers[activeIndex] ?? tiers[0]
  const activeLabel = active?.label ?? 'unknown'
  const isDisabled = tiers.length === 0
  const surfaceProps = occludeNativeBrowserSurface ? BROWSER_NATIVE_SURFACE_OCCLUSION_PROPS : {}
  const pointerStartXRef = useRef<number | null>(null)
  const pointerStartIndexRef = useRef(currentIndex)
  const longPressTimerRef = useRef<number | null>(null)
  const movedRef = useRef(false)
  const draggingRef = useRef(false)
  const dragIndexRef = useRef(currentIndex)
  const stripWidth = tiers.length * SEGMENT_WIDTH + STRIP_PADDING_X * 2
  const transition: Transition = reduceMotion
    ? { duration: 0 }
    : { type: 'spring', stiffness: 620, damping: 42, mass: 0.58 }

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const updateDragPosition = (delta: number) => {
    if (tiers.length === 0) {
      return
    }

    const rawX = pointerStartIndexRef.current * SEGMENT_WIDTH + delta
    const nextIndex = clampIndex(Math.round(rawX / SEGMENT_WIDTH), tiers.length)
    const previousIndex = dragIndexRef.current

    dragIndexRef.current = nextIndex
    if (nextIndex !== previousIndex) {
      setDragIndex(nextIndex)
    }
  }

  const startDragging = (delta = 0) => {
    if (pointerStartXRef.current === null || tiers.length === 0) {
      return
    }

    draggingRef.current = true
    dragIndexRef.current = pointerStartIndexRef.current
    setMode('dragging')
    setDragIndex(pointerStartIndexRef.current)
    updateDragPosition(delta)
  }

  const selectOffset = (offset: number) => {
    if (tiers.length === 0) {
      return
    }
    const nextIndex = (currentIndex + offset + tiers.length) % tiers.length
    onSelect(tiers[nextIndex].value)
  }

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (isDisabled || (event.pointerType === 'mouse' && event.button !== 0)) {
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    pointerStartXRef.current = event.clientX
    pointerStartIndexRef.current = currentIndex
    movedRef.current = false
    draggingRef.current = false
    dragIndexRef.current = currentIndex
    setDragIndex(currentIndex)
    clearLongPress()
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null
      if (movedRef.current || pointerStartXRef.current === null) {
        return
      }
      startDragging()
    }, LONG_PRESS_MS)
  }

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (pointerStartXRef.current === null || tiers.length === 0) {
      return
    }

    const delta = event.clientX - pointerStartXRef.current
    if (!draggingRef.current) {
      if (Math.abs(delta) > DRAG_START_THRESHOLD_PX) {
        movedRef.current = true
        clearLongPress()
        startDragging(delta)
      }
      return
    }

    updateDragPosition(delta)
  }

  const handlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    catch {
      // Pointer capture may already be released.
    }

    const wasDragging = draggingRef.current
    const wasShortPress = longPressTimerRef.current !== null
    clearLongPress()
    pointerStartXRef.current = null
    draggingRef.current = false

    if (wasDragging) {
      const committed = tiers[dragIndexRef.current] ?? active
      if (committed && committed.value !== thinkingEffort) {
        onSelect(committed.value)
      }
      setMode('idle')
      return
    }

    if (wasShortPress && !movedRef.current) {
      selectOffset(1)
    }
  }

  const handlePointerCancel = () => {
    clearLongPress()
    pointerStartXRef.current = null
    draggingRef.current = false
    dragIndexRef.current = currentIndex
    setMode('idle')
    setDragIndex(currentIndex)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault()
      selectOffset(1)
    }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault()
      selectOffset(-1)
    }
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      selectOffset(1)
    }
  }

  return (
    <m.button
      {...surfaceProps}
      layout
      initial={false}
      animate={{ scale: mode === 'dragging' ? 1.02 : 1 }}
      transition={transition}
      type="button"
      data-testid="claude-agent-thinking-effort-trigger"
      data-thinking-effort={active?.value ?? ''}
      data-mode={mode}
      disabled={isDisabled}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onKeyDown={handleKeyDown}
      aria-label={`Thinking effort: ${activeLabel}. Click to cycle or long-press and drag to adjust.`}
      title={`Thinking effort: ${activeLabel}`}
      className={cn(
        'inline-flex h-6 shrink-0 select-none items-center gap-1.5 rounded-[min(var(--radius-md),10px)] px-1.5 text-xs outline-none',
        'bg-foreground/[0.055] text-muted-foreground transition-colors',
        'hover:bg-foreground/[0.08] hover:text-foreground',
        'focus-visible:ring-2 focus-visible:ring-primary/35',
        mode === 'dragging' && 'cursor-grabbing bg-foreground/[0.08] text-foreground',
        'disabled:pointer-events-none disabled:opacity-50',
      )}
      style={{ touchAction: 'none' }}
    >
      <m.span
        layout
        aria-hidden="true"
        className="relative inline-flex h-5 shrink-0 items-center overflow-hidden rounded-[7px] bg-foreground/[0.07] p-0.5"
        style={{ width: stripWidth }}
        transition={transition}
      >
        {!isDisabled && (
          <m.span
            aria-hidden="true"
            initial={false}
            className="absolute top-0.5 bottom-0.5 rounded-[5px] bg-background/65 shadow-[0_1px_1px_rgb(0_0_0_/_0.08)]"
            animate={{ x: activeIndex * SEGMENT_WIDTH, width: SEGMENT_WIDTH }}
            transition={transition}
            style={{ left: STRIP_PADDING_X }}
          />
        )}
        {tiers.map((tier, index) => {
          const isSelected = index === activeIndex
          const filledDotCount = Math.max(1, Math.round(((index + 1) / tiers.length) * MATRIX_DOT_COUNT))
          return (
            <span
              key={tier.value}
              style={{ width: SEGMENT_WIDTH }}
              className={cn(
                'relative z-10 grid h-4 grid-cols-3 grid-rows-2 place-items-center rounded-[5px] px-1 transition-colors',
                index > 0 && 'before:absolute before:left-0 before:top-1/2 before:h-2 before:w-px before:-translate-y-1/2 before:bg-foreground/10',
                isSelected && 'before:bg-transparent',
              )}
            >
              {MATRIX_DOTS.map(dotIndex => (
                <span
                  key={dotIndex}
                  className={cn(
                    'size-1 rounded-full transition-colors',
                    dotIndex < filledDotCount
                      ? isSelected ? 'bg-foreground/75' : 'bg-muted-foreground/35'
                      : isSelected ? 'bg-foreground/16' : 'bg-muted-foreground/12',
                  )}
                />
              ))}
            </span>
          )
        })}
      </m.span>
      <m.span layout className="min-w-[3ch] whitespace-nowrap text-[11px] font-medium text-muted-foreground/80">
        {activeLabel}
      </m.span>
    </m.button>
  )
}
