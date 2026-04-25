// Input: UIMessage[], scroll metrics, onScrollToIndex, onScrollTo
// Output: ChatMinimap — barcode-style minimap with horizontal ticks per message
// Position: Overlay component pinned to the right edge of the chat scroll area

import { cn } from '@renderer/lib/utils'
import type { UIMessage } from 'ai'
import { memo, useCallback, useMemo, useRef, useState } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMinimapProps {
  messages: UIMessage[]
  scrollOffset: number
  scrollHeight: number
  viewportHeight: number
  /** Per-message reading progress (0–1), computed from real virtualizer item positions. */
  barProgress: number[]
  onScrollToIndex: (index: number) => void
  onScrollTo: (offset: number) => void
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractText(msg: UIMessage): string {
  const texts: string[] = []
  for (const part of msg.parts) {
    if (part.type === 'text') {
      texts.push((part as { text: string }).text)
    }
  }
  return texts.join('\n').trim() || (msg.role === 'user' ? '用户消息' : '助手回复')
}

/** Compute bar width — normalized to 50%~100% range */
function barWidth(text: string): number {
  const normalized = Math.sqrt(Math.min(text.length / 300, 1))
  return 50 + normalized * 50
}

// ── Component ─────────────────────────────────────────────────────────────────

function ChatMinimapInner({
  messages,
  scrollOffset: _scrollOffset,
  scrollHeight,
  viewportHeight,
  barProgress,
  onScrollToIndex,
  onScrollTo,
}: ChatMinimapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [hoverClientY, setHoverClientY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [containerHeight, setContainerHeight] = useState(0)
  const [containerTop, setContainerTop] = useState(0)

  // Precompute bar data
  const bars = useMemo(
    () => messages.map((msg) => {
      const text = extractText(msg)
      return {
        role: msg.role as 'user' | 'assistant',
        width: barWidth(text),
        preview: text.length > 120 ? `${text.slice(0, 120)}…` : text,
      }
    }),
    [messages],
  )

  const hoveredBar = hoverIdx !== null ? bars[hoverIdx] : null

  // Viewport position (for future use)
  const scrollable = (scrollHeight - viewportHeight) || 1

  // Map mouse Y → message index
  const yToIndex = useCallback(
    (y: number, height: number) => {
      if (bars.length === 0 || height === 0) {
        return 0
      }
      const ratio = Math.max(0, Math.min(1, y / height))
      return Math.min(Math.floor(ratio * bars.length), bars.length - 1)
    },
    [bars],
  )

  // Map mouse Y → scroll offset
  const yToScroll = useCallback(
    (y: number, height: number) => {
      const ratio = Math.max(0, Math.min(1, y / height))
      return ratio * scrollable
    },
    [scrollable],
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      setIsDragging(true)
        ; (e.target as HTMLElement).setPointerCapture(e.pointerId)
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect) {
        setContainerHeight(rect.height)
        setContainerTop(rect.top)
        const y = e.clientY - rect.top
        setHoverIdx(yToIndex(y, rect.height))
        setHoverClientY(e.clientY)
      }
    },
    [yToIndex],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) {
        return
      }
      setContainerHeight(rect.height)
      setContainerTop(rect.top)
      const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height))
      setHoverIdx(yToIndex(y, rect.height))
      setHoverClientY(e.clientY)
      if (isDragging) {
        onScrollTo(yToScroll(y, rect.height))
      }
    },
    [isDragging, onScrollTo, yToIndex, yToScroll],
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      setIsDragging(false)
        ; (e.target as HTMLElement).releasePointerCapture(e.pointerId)
    },
    [],
  )

  const handlePointerLeave = useCallback(() => {
    if (!isDragging) {
      setHoverIdx(null)
    }
  }, [isDragging])

  const handleClick = useCallback(() => {
    if (hoverIdx !== null) {
      onScrollToIndex(hoverIdx)
    }
  }, [hoverIdx, onScrollToIndex])

  if (messages.length === 0) {
    return null
  }

  // Compute hover peek position (clamped to container)
  const peekTop = hoverIdx !== null
    ? Math.max(0, Math.min(hoverClientY - containerTop - 40, containerHeight - 120))
    : 0

  return (
    <div
      className="absolute -right-2 top-0 bottom-0 z-10 flex w-8 items-center justify-center"
      aria-hidden="true"
    >
      {/* Bar group — pointer events only on the actual bars */}
      <div
        ref={containerRef}
        className="relative flex w-full cursor-pointer flex-col items-center gap-0.5"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onClick={handleClick}
      >
        {bars.map((bar, i) => {
          const progress = barProgress[i] ?? 0
          return (
            <div
              key={messages[i].id}
              className={cn(
                'relative h-1.5 overflow-hidden rounded-full transition-colors duration-100',
                bar.role === 'user'
                  ? 'bg-foreground/10'
                  : 'bg-foreground/5',
                hoverIdx === i && 'bg-accent/30',
              )}
              style={{ width: `${bar.width}%` }}
            >
              {/* Reading progress fill */}
              <div
                className={cn(
                  'absolute inset-y-0 left-0 rounded-full',
                  hoverIdx === i
                    ? 'bg-accent'
                    : bar.role === 'user'
                      ? 'bg-foreground/30'
                      : 'bg-foreground/15',
                )}
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          )
        })}

        {/* Hover peek popover */}
        {hoveredBar && hoverIdx !== null && (
          <div
            className="absolute right-full mr-2 w-56 rounded-lg border border-border bg-popover p-2.5 text-popover-foreground shadow-md pointer-events-none"
            style={{
              top: peekTop,
              transition: 'top 80ms ease-out',
            }}
          >
            <div className="mb-1 flex items-center gap-1.5">
              <div
                className={cn(
                  'size-1.5 rounded-full',
                  hoveredBar.role === 'user' ? 'bg-foreground/50' : 'bg-accent/70',
                )}
              />
              <span className="text-[10px] font-medium text-muted-foreground/60">
                {`${hoveredBar.role === 'user' ? '用户' : '助手'} · #${hoverIdx + 1}`}
              </span>
            </div>
            <p className="text-xs/relaxed text-foreground line-clamp-4">
              {hoveredBar.preview}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export const ChatMinimap = memo(ChatMinimapInner)
