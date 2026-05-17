// Input: UIMessage[], scroll metrics, onScrollToIndex, onScrollTo
// Output: ChatMinimap — barcode-style minimap with horizontal ticks per message
// Position: Overlay component pinned to the right edge of the chat scroll area

import type { UIMessage } from 'ai'
import { memo, useCallback, useMemo, useReducer, useRef } from 'react'

import { cn } from '~/lib/cn'

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

interface ChatMinimapUiState {
  hoverIdx: number | null
  hoverClientY: number
  isDragging: boolean
  containerHeight: number
  containerTop: number
}

type ChatMinimapUiAction
  = { type: 'pointer-start', hoverIdx: number, hoverClientY: number, containerHeight: number, containerTop: number }
    | { type: 'pointer-move', hoverIdx: number, hoverClientY: number, containerHeight: number, containerTop: number }
    | { type: 'pointer-end' }
    | { type: 'pointer-leave' }

const initialChatMinimapUiState: ChatMinimapUiState = {
  hoverIdx: null,
  hoverClientY: 0,
  isDragging: false,
  containerHeight: 0,
  containerTop: 0,
}

function chatMinimapUiReducer(state: ChatMinimapUiState, action: ChatMinimapUiAction): ChatMinimapUiState {
  switch (action.type) {
    case 'pointer-start':
      return {
        hoverIdx: action.hoverIdx,
        hoverClientY: action.hoverClientY,
        isDragging: true,
        containerHeight: action.containerHeight,
        containerTop: action.containerTop,
      }
    case 'pointer-move':
      return {
        ...state,
        hoverIdx: action.hoverIdx,
        hoverClientY: action.hoverClientY,
        containerHeight: action.containerHeight,
        containerTop: action.containerTop,
      }
    case 'pointer-end':
      return {
        ...state,
        isDragging: false,
      }
    case 'pointer-leave':
      return state.isDragging
        ? state
        : {
            ...state,
            hoverIdx: null,
          }
    default:
      return state
  }
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
  const [uiState, dispatch] = useReducer(chatMinimapUiReducer, initialChatMinimapUiState)

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

  const hoveredBar = uiState.hoverIdx !== null ? bars[uiState.hoverIdx] : null

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
      ; (e.target as HTMLElement).setPointerCapture(e.pointerId)
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect) {
        const y = e.clientY - rect.top
        dispatch({
          type: 'pointer-start',
          hoverIdx: yToIndex(y, rect.height),
          hoverClientY: e.clientY,
          containerHeight: rect.height,
          containerTop: rect.top,
        })
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
      const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height))
      dispatch({
        type: 'pointer-move',
        hoverIdx: yToIndex(y, rect.height),
        hoverClientY: e.clientY,
        containerHeight: rect.height,
        containerTop: rect.top,
      })
      if (uiState.isDragging) {
        onScrollTo(yToScroll(y, rect.height))
      }
    },
    [onScrollTo, uiState.isDragging, yToIndex, yToScroll],
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      dispatch({ type: 'pointer-end' })
      ; (e.target as HTMLElement).releasePointerCapture(e.pointerId)
    },
    [],
  )

  const handlePointerLeave = useCallback(() => {
    dispatch({ type: 'pointer-leave' })
  }, [])

  const scrollToHoveredMessage = useCallback(() => {
    if (uiState.hoverIdx !== null) {
      onScrollToIndex(uiState.hoverIdx)
    }
  }, [onScrollToIndex, uiState.hoverIdx])

  if (messages.length === 0) {
    return null
  }

  // Compute hover peek position (clamped to container)
  const peekTop = uiState.hoverIdx !== null
    ? Math.max(0, Math.min(uiState.hoverClientY - uiState.containerTop - 40, uiState.containerHeight - 120))
    : 0

  return (
    <div
      className="absolute -right-2 top-0 bottom-0 z-10 flex w-8 items-center justify-center"
      aria-hidden="true"
    >
      {/* Bar group — pointer events only on the actual bars */}
      <div
        ref={containerRef}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            scrollToHoveredMessage()
          }
        }}
        className="relative flex w-full cursor-pointer flex-col items-center gap-1"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onClick={scrollToHoveredMessage}
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
                uiState.hoverIdx === i && 'bg-accent/30',
              )}
              style={{ width: `${bar.width}%` }}
            >
              {/* Reading progress fill */}
              <div
                className={cn(
                  'absolute inset-y-0 left-0 rounded-full',
                  uiState.hoverIdx === i
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
        {hoveredBar && uiState.hoverIdx !== null && (
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
              <span className="text-[10px] font-medium text-muted-foreground">
                {`${hoveredBar.role === 'user' ? '用户' : '助手'} · #${uiState.hoverIdx + 1}`}
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
