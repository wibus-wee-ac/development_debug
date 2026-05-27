import type { UIMessage } from 'ai'
import type { Ref } from 'react'
import { memo, useCallback, useImperativeHandle, useReducer, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { cn } from '~/lib/cn'
import { chatSelectors, useChatStore } from '~/store/chat'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMinimapProps {
  sessionId: string | null
  messageIds: string[]
  scrollHeight: number
  viewportHeight: number
  onScrollToIndex: (index: number) => void
  onScrollTo: (offset: number) => void
  ref?: Ref<ChatMinimapHandle>
}

export interface ChatMinimapHandle {
  setScrollProgress: (progress: number) => void
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

interface ChatMinimapBarData {
  role: 'user' | 'assistant'
  width: number
  preview: string
}

function readBarData(message: UIMessage | undefined): ChatMinimapBarData | null {
  if (!message) {
    return null
  }
  const text = extractText(message)
  return {
    role: message.role as 'user' | 'assistant',
    width: barWidth(text),
    preview: text.length > 120 ? `${text.slice(0, 120)}…` : text,
  }
}

/** Compute bar width — normalized to 50%~100% range */
function barWidth(text: string): number {
  const normalized = Math.sqrt(Math.min(text.length / 300, 1))
  return 50 + normalized * 50
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

// ── Component ─────────────────────────────────────────────────────────────────

function ChatMinimapInner({
  sessionId,
  messageIds,
  scrollHeight,
  viewportHeight,
  onScrollToIndex,
  onScrollTo,
  ref,
}: ChatMinimapProps) {
  const containerRef = useRef<HTMLButtonElement>(null)
  const barProgressRef = useRef<Array<HTMLSpanElement | null>>([])
  const barProgressValuesRef = useRef<number[]>([])
  const activeIndexRef = useRef(0)
  const [uiState, dispatch] = useReducer(chatMinimapUiReducer, initialChatMinimapUiState)

  const scrollable = Math.max(scrollHeight - viewportHeight, 1)
  const messageCount = messageIds.length

  const setScrollProgress = useCallback((progress: number) => {
    const nextProgress = clamp01(progress)
    const visualPosition = nextProgress * messageCount
    const activeIndex = nextProgress >= 1 ? messageCount - 1 : Math.floor(visualPosition)
    const activeProgress = nextProgress >= 1 ? 1 : visualPosition - activeIndex
    activeIndexRef.current = Math.max(0, activeIndex)

    for (let index = 0; index < messageCount; index++) {
      const fill = barProgressRef.current[index]
      if (!fill) {
        continue
      }

      const scale = index < activeIndex
        ? 1
        : index === activeIndex
          ? activeProgress
          : 0

      if (barProgressValuesRef.current[index] === scale) {
        continue
      }

      barProgressValuesRef.current[index] = scale
      fill.style.transform = `scaleX(${scale})`
    }
  }, [messageCount])

  useImperativeHandle(ref, () => ({ setScrollProgress }), [setScrollProgress])

  // Map mouse Y → message index
  const yToIndex = useCallback(
    (y: number, height: number) => {
      if (messageCount === 0 || height === 0) {
        return 0
      }
      const ratio = Math.max(0, Math.min(1, y / height))
      return Math.min(Math.floor(ratio * messageCount), messageCount - 1)
    },
    [messageCount],
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
      e.currentTarget.setPointerCapture(e.pointerId)
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
      e.currentTarget.releasePointerCapture(e.pointerId)
    },
    [],
  )

  const handlePointerLeave = useCallback(() => {
    dispatch({ type: 'pointer-leave' })
  }, [])

  const scrollToEventMessage = useCallback(
    (clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) {
        return
      }

      const y = Math.max(0, Math.min(clientY - rect.top, rect.height))
      onScrollToIndex(yToIndex(y, rect.height))
    },
    [onScrollToIndex, yToIndex],
  )

  const scrollToKeyboardMessage = useCallback(() => {
    onScrollToIndex(uiState.hoverIdx ?? Math.min(activeIndexRef.current, messageCount - 1))
  }, [messageCount, onScrollToIndex, uiState.hoverIdx])

  if (messageIds.length === 0) {
    return null
  }

  // Compute hover peek position (clamped to container)
  const peekTop = uiState.hoverIdx !== null
    ? Math.max(0, Math.min(uiState.hoverClientY - uiState.containerTop - 40, uiState.containerHeight - 120))
    : 0

  return (
    <div
      className="absolute -right-2 top-0 bottom-0 z-10 flex w-8 items-center justify-center"
    >
      <button
        type="button"
        ref={containerRef}
        aria-label="Chat minimap"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            scrollToKeyboardMessage()
          }
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onClick={e => scrollToEventMessage(e.clientY)}
        className="relative flex w-full cursor-pointer flex-col items-center gap-1 rounded-full bg-transparent p-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {messageIds.map((messageId, i) => {
          return (
            <ChatMinimapBar
              key={messageId}
              sessionId={sessionId}
              messageId={messageId}
              index={i}
              hovered={uiState.hoverIdx === i}
              progressRefs={barProgressRef}
            />
          )
        })}
      </button>

      {/* Hover peek popover */}
      {uiState.hoverIdx !== null && (
        <ChatMinimapHoverPreview
          sessionId={sessionId}
          messageId={messageIds[uiState.hoverIdx]}
          index={uiState.hoverIdx}
          top={peekTop}
        />
      )}
    </div>
  )
}

function ChatMinimapBar({
  sessionId,
  messageId,
  index,
  hovered,
  progressRefs,
}: {
  sessionId: string | null
  messageId: string
  index: number
  hovered: boolean
  progressRefs: React.RefObject<Array<HTMLSpanElement | null>>
}) {
  const bar = useChatStore(useShallow(state =>
    readBarData(chatSelectors.message(sessionId ?? '', messageId)(state))))

  if (!bar) {
    return null
  }

  return (
    <span
      className={cn(
        'relative h-1.5 overflow-hidden rounded-full transition-colors duration-100',
        bar.role === 'user'
          ? 'bg-foreground/10'
          : 'bg-foreground/5',
        hovered && 'bg-accent/30',
      )}
      style={{ width: `${bar.width}%` }}
    >
      <span
        ref={(node) => {
          progressRefs.current[index] = node
        }}
        className={cn(
          'absolute inset-y-0 left-0 w-full origin-left rounded-full transform-gpu',
          hovered
            ? 'bg-accent'
            : bar.role === 'user'
              ? 'bg-foreground/30'
              : 'bg-foreground/15',
        )}
        style={{ transform: 'scaleX(0)' }}
      />
    </span>
  )
}

function ChatMinimapHoverPreview({
  sessionId,
  messageId,
  index,
  top,
}: {
  sessionId: string | null
  messageId: string | undefined
  index: number
  top: number
}) {
  const bar = useChatStore(useShallow(state =>
    messageId ? readBarData(chatSelectors.message(sessionId ?? '', messageId)(state)) : null))

  if (!bar) {
    return null
  }

  return (
    <div
      className="pointer-events-none absolute right-full mr-2 w-56 rounded-lg border border-border bg-popover p-2.5 text-popover-foreground shadow-md"
      style={{
        top,
      }}
    >
      <div className="mb-1 flex items-center gap-1.5">
        <div
          className={cn(
            'size-1.5 rounded-full',
            bar.role === 'user' ? 'bg-foreground/50' : 'bg-accent/70',
          )}
        />
        <span className="text-[10px] font-medium text-muted-foreground">
          {`${bar.role === 'user' ? '用户' : '助手'} · #${index + 1}`}
        </span>
      </div>
      <p className="text-xs/relaxed text-foreground line-clamp-4">
        {bar.preview}
      </p>
    </div>
  )
}

const ChatMinimapWithRef = memo(ChatMinimapInner)
ChatMinimapWithRef.displayName = 'ChatMinimap'

export { ChatMinimapWithRef as ChatMinimap }
