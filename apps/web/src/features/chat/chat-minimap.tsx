import type { UIMessage } from 'ai'
import type { Ref } from 'react'
import { memo, useCallback, useImperativeHandle, useReducer, useRef } from 'react'

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
  setActiveMessageIndex: (index: number) => void
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

interface ChatMinimapAnchor {
  messageIndex: number
  preview: string
}

function readAnchorData(message: UIMessage | undefined, messageIndex: number): ChatMinimapAnchor | null {
  if (!message || message.role !== 'user') {
    return null
  }
  const text = extractText(message)
  return {
    messageIndex,
    preview: text.length > 120 ? `${text.slice(0, 120)}…` : text,
  }
}

const EMPTY_MINIMAP_ANCHORS: ChatMinimapAnchor[] = []

type ChatStoreSnapshot = ReturnType<typeof useChatStore.getState>

function readMinimapAnchors(
  state: ChatStoreSnapshot,
  sessionId: string,
  messageIds: string[],
): ChatMinimapAnchor[] {
  if (messageIds.length === 0) {
    return EMPTY_MINIMAP_ANCHORS
  }

  const messages = chatSelectors.messages(sessionId)(state)
  if (messages.length === 0) {
    return EMPTY_MINIMAP_ANCHORS
  }

  if (messages.length === messageIds.length) {
    let sameOrder = true
    for (let index = 0; index < messages.length; index++) {
      if (messages[index].id !== messageIds[index]) {
        sameOrder = false
        break
      }
    }
    if (sameOrder) {
      return messages.flatMap((message, index) => {
        const anchor = readAnchorData(message, index)
        return anchor ? [anchor] : []
      })
    }
  }

  const messageById = new Map(messages.map(message => [message.id, message]))
  return messageIds.flatMap((messageId, index) => {
    const anchor = readAnchorData(messageById.get(messageId), index)
    return anchor ? [anchor] : []
  })
}

function areMinimapAnchorsEqual(
  left: ChatMinimapAnchor[],
  right: ChatMinimapAnchor[],
): boolean {
  if (left === right) {
    return true
  }
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index++) {
    if (left[index].messageIndex !== right[index].messageIndex || left[index].preview !== right[index].preview) {
      return false
    }
  }
  return true
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
  const anchorNodesRef = useRef<Array<HTMLSpanElement | null>>([])
  const activeAnchorRef = useRef(0)
  const activeAnchorValueRef = useRef<number | null>(null)
  const [uiState, dispatch] = useReducer(chatMinimapUiReducer, initialChatMinimapUiState)
  const anchors = useChatStore(
    state => readMinimapAnchors(state, sessionId ?? '', messageIds),
    areMinimapAnchorsEqual,
  )

  const scrollable = Math.max(scrollHeight - viewportHeight, 1)
  const anchorCount = anchors.length

  const setActiveMessageIndex = useCallback((messageIndex: number) => {
    if (anchorCount === 0) {
      activeAnchorRef.current = 0
      activeAnchorValueRef.current = null
      return
    }

    let activeAnchor = 0
    for (let index = 0; index < anchorCount; index++) {
      if (anchors[index].messageIndex > messageIndex) {
        break
      }
      activeAnchor = index
    }

    if (activeAnchorValueRef.current === activeAnchor) {
      return
    }

    activeAnchorRef.current = activeAnchor
    activeAnchorValueRef.current = activeAnchor

    for (let index = 0; index < anchorCount; index++) {
      const bar = anchorNodesRef.current[index]
      if (!bar) {
        continue
      }
      bar.dataset.active = index === activeAnchor ? 'true' : 'false'
    }
  }, [anchorCount, anchors])

  const setAnchorNode = useCallback((index: number, node: HTMLSpanElement | null) => {
    anchorNodesRef.current[index] = node
  }, [])

  useImperativeHandle(ref, () => ({ setActiveMessageIndex }), [setActiveMessageIndex])

  // Map mouse Y to user-message anchor index.
  const yToIndex = useCallback(
    (y: number, height: number) => {
      if (anchorCount === 0 || height === 0) {
        return 0
      }
      const ratio = Math.max(0, Math.min(1, y / height))
      return Math.min(Math.floor(ratio * anchorCount), anchorCount - 1)
    },
    [anchorCount],
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
      const anchor = anchors[yToIndex(y, rect.height)]
      if (anchor) {
        onScrollToIndex(anchor.messageIndex)
      }
    },
    [anchors, onScrollToIndex, yToIndex],
  )

  const scrollToKeyboardMessage = useCallback(() => {
    const anchor = anchors[uiState.hoverIdx ?? activeAnchorRef.current]
    if (anchor) {
      onScrollToIndex(anchor.messageIndex)
    }
  }, [anchors, onScrollToIndex, uiState.hoverIdx])

  if (anchorCount === 0) {
    return null
  }

  // Compute hover peek position (clamped to container)
  const peekTop = uiState.hoverIdx !== null
    ? Math.max(0, Math.min(uiState.hoverClientY - uiState.containerTop - 40, uiState.containerHeight - 120))
    : 0

  return (
    <div
      className="pointer-events-none absolute right-7 top-0 bottom-0 z-10 flex w-10 items-center justify-center"
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
        className="pointer-events-auto relative flex h-[min(70vh,520px)] min-h-40 w-10 cursor-pointer flex-col items-center justify-center gap-3 rounded-full bg-transparent p-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {anchors.map((anchor, i) => {
          return (
            <ChatMinimapBar
              key={messageIds[anchor.messageIndex]}
              index={i}
              hovered={uiState.hoverIdx === i}
              setAnchorNode={setAnchorNode}
            />
          )
        })}
      </button>

      {/* Hover peek popover */}
      {uiState.hoverIdx !== null && (
        <ChatMinimapHoverPreview
          anchor={anchors[uiState.hoverIdx]}
          index={uiState.hoverIdx}
          top={peekTop}
        />
      )}
    </div>
  )
}

function ChatMinimapBar({
  index,
  hovered,
  setAnchorNode,
}: {
  index: number
  hovered: boolean
  setAnchorNode: (index: number, node: HTMLSpanElement | null) => void
}) {
  return (
    <span
      ref={(node) => {
        setAnchorNode(index, node)
      }}
      data-active="false"
      className={cn(
        'block h-1 w-9 rounded-full bg-foreground/40 transition-[background-color,opacity,scale] duration-150',
        'data-[active=true]:bg-foreground/95 data-[active=true]:opacity-100',
        'opacity-55',
        hovered && 'scale-x-110 bg-foreground/80 opacity-100',
      )}
    />
  )
}

function ChatMinimapHoverPreview({
  anchor,
  index,
  top,
}: {
  anchor: ChatMinimapAnchor | null | undefined
  index: number
  top: number
}) {
  if (!anchor) {
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
            'bg-foreground/50',
          )}
        />
        <span className="text-[10px] font-medium text-muted-foreground">
          {`User · #${index + 1}`}
        </span>
      </div>
      <p className="text-xs/relaxed text-foreground line-clamp-4">
        {anchor.preview}
      </p>
    </div>
  )
}

const ChatMinimapWithRef = memo(ChatMinimapInner)
ChatMinimapWithRef.displayName = 'ChatMinimap'

export { ChatMinimapWithRef as ChatMinimap }
