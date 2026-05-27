// Output: Chat scroll runtime hook for viewport refs, minimap sync, and chat attention snapshots.
// Input: Chat session id, rendered message ids, and chat generation status.
// Position: Owned by features/chat as the scroll controller boundary consumed by ChatView.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { VirtualizerHandle } from 'virtua'
import { useShallow } from 'zustand/react/shallow'

import { useChatStore } from '~/store/chat'

import { clearChatAttentionSnapshot, installChatContextProvider, updateChatAttentionSnapshot } from './chat-context'
import type { ChatMinimapHandle } from './chat-minimap'

export interface ChatScrollMetrics {
  offset: number
  scrollHeight: number
  viewportHeight: number
}

export interface ChatScrollRuntime {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
  viewportRef: React.RefObject<HTMLDivElement | null>
  virtualizerRef: React.RefObject<VirtualizerHandle | null>
  minimapRef: React.RefObject<ChatMinimapHandle | null>
  keepMountedIndices?: number[]
  metrics: ChatScrollMetrics
  handleVirtualScroll: (offset: number) => void
  scrollToMessageIndex: (index: number) => void
  scrollToOffset: (offset: number) => void
  handleComposerFocusChange: (focused: boolean) => void
}

interface UseChatScrollRuntimeOptions {
  sessionId: string | null
  messageIds: string[]
  status: string
}

const EMPTY_SCROLL_METRICS: ChatScrollMetrics = { offset: 0, scrollHeight: 0, viewportHeight: 0 }
const BOTTOM_PROXIMITY_PX = 200

function readScrollRatio(metrics: ChatScrollMetrics): number {
  const scrollable = Math.max(metrics.scrollHeight - metrics.viewportHeight, 0)
  return scrollable > 0 ? metrics.offset / scrollable : 1
}

function readMinimapProgress(metrics: ChatScrollMetrics): number {
  return Math.max(0, Math.min(1, readScrollRatio(metrics)))
}

function readIsAtBottom(metrics: ChatScrollMetrics): boolean {
  return metrics.offset + metrics.viewportHeight >= metrics.scrollHeight - BOTTOM_PROXIMITY_PX
}

export function useChatScrollRuntime({
  sessionId,
  messageIds,
  status,
}: UseChatScrollRuntimeOptions): ChatScrollRuntime {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const virtualizerRef = useRef<VirtualizerHandle>(null)
  const minimapRef = useRef<ChatMinimapHandle>(null)
  const isAtBottomRef = useRef(true)
  const initialScrollDoneRef = useRef(false)
  const messageIdsRef = useRef(messageIds)
  const sessionIdRef = useRef(sessionId)
  const [metrics, setMetrics] = useState<ChatScrollMetrics>(EMPTY_SCROLL_METRICS)

  useEffect(() => {
    messageIdsRef.current = messageIds
  }, [messageIds])

  useEffect(() => {
    sessionIdRef.current = sessionId
    initialScrollDoneRef.current = false
    isAtBottomRef.current = true
    setMetrics(EMPTY_SCROLL_METRICS)
    minimapRef.current?.setScrollProgress(1)
  }, [sessionId])

  useEffect(() => {
    installChatContextProvider()
  }, [])

  useEffect(() => {
    return () => clearChatAttentionSnapshot(sessionId)
  }, [sessionId])

  const [generatingMessageIds, passiveStreamingMessageIds] = useChatStore(useShallow(state => [
    state.generatingMessageIds,
    state.passiveStreamingMessageIds,
  ]))
  const streamingMessageIds = useMemo(
    () => new Set([...generatingMessageIds, ...passiveStreamingMessageIds]),
    [generatingMessageIds, passiveStreamingMessageIds],
  )
  const keepMountedIndices = useMemo(() => {
    if (streamingMessageIds.size === 0) {
      return undefined
    }

    const indices: number[] = []
    for (let i = 0; i < messageIds.length; i++) {
      if (streamingMessageIds.has(messageIds[i])) {
        indices.push(i)
      }
    }
    return indices.length > 0 ? indices : undefined
  }, [streamingMessageIds, messageIds])

  const readScrollMetrics = useCallback((): ChatScrollMetrics | null => {
    const viewport = viewportRef.current
    if (!viewport) {
      return null
    }

    return {
      offset: viewport.scrollTop,
      scrollHeight: viewport.scrollHeight,
      viewportHeight: viewport.offsetHeight,
    }
  }, [])

  const writeChatAttentionSnapshot = useCallback((nextMetrics: ChatScrollMetrics | null) => {
    const currentSessionId = sessionIdRef.current
    const currentMessageIds = messageIdsRef.current
    if (!currentSessionId || currentMessageIds.length === 0 || !nextMetrics) {
      clearChatAttentionSnapshot(currentSessionId)
      return
    }

    const virtualizer = virtualizerRef.current
    const firstVisibleIndex = virtualizer
      ? Math.max(0, Math.min(currentMessageIds.length - 1, virtualizer.findItemIndex(nextMetrics.offset)))
      : null
    const lastVisibleIndex = virtualizer
      ? Math.max(0, Math.min(currentMessageIds.length - 1, virtualizer.findItemIndex(nextMetrics.offset + nextMetrics.viewportHeight)))
      : null

    updateChatAttentionSnapshot(currentSessionId, {
      messageCount: currentMessageIds.length,
      firstVisibleIndex,
      lastVisibleIndex,
      scrollRatio: readScrollRatio(nextMetrics),
      isAtBottom: isAtBottomRef.current,
      updatedAt: Date.now(),
    })
  }, [])

  const writeMinimapProgress = useCallback((nextMetrics?: ChatScrollMetrics | null) => {
    const currentMessageIds = messageIdsRef.current
    const currentMetrics = nextMetrics ?? readScrollMetrics()
    if (currentMessageIds.length === 0 || !currentMetrics) {
      return
    }

    minimapRef.current?.setScrollProgress(readMinimapProgress(currentMetrics))
  }, [readScrollMetrics])

  const refreshScrollMetrics = useCallback(() => {
    const nextMetrics = readScrollMetrics()
    if (nextMetrics) {
      setMetrics(nextMetrics)
      writeChatAttentionSnapshot(nextMetrics)
    }
    writeMinimapProgress(nextMetrics)
  }, [readScrollMetrics, writeChatAttentionSnapshot, writeMinimapProgress])

  const scrollToBottom = useCallback(() => {
    const viewport = viewportRef.current
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight
      isAtBottomRef.current = true
    }
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (viewport) {
      viewport.style.overflowAnchor = 'none'
    }
  }, [])

  useEffect(() => {
    if (initialScrollDoneRef.current || messageIds.length === 0) {
      return
    }

    initialScrollDoneRef.current = true
    virtualizerRef.current?.scrollToIndex(messageIds.length - 1, { align: 'end' })
    requestAnimationFrame(() => {
      const viewport = viewportRef.current
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight
      }
      refreshScrollMetrics()
    })
  }, [messageIds.length, refreshScrollMetrics])

  useEffect(() => {
    if (!isAtBottomRef.current) {
      return
    }

    scrollToBottom()
    requestAnimationFrame(refreshScrollMetrics)
  }, [messageIds.length, status, refreshScrollMetrics, scrollToBottom])

  const handleVirtualScroll = useCallback((offset: number) => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    isAtBottomRef.current = offset + viewport.offsetHeight >= viewport.scrollHeight - BOTTOM_PROXIMITY_PX
  }, [])

  useEffect(() => {
    let frame = 0
    let lastScrollTop = -1
    let lastScrollHeight = -1
    let lastViewportHeight = -1

    const syncScrollObservers = () => {
      const viewport = viewportRef.current
      if (viewport) {
        const wasAtBottom = isAtBottomRef.current
        let scrollTop = viewport.scrollTop
        let scrollHeight = viewport.scrollHeight
        const viewportHeight = viewport.offsetHeight

        if (wasAtBottom && lastScrollHeight >= 0 && scrollHeight > lastScrollHeight) {
          viewport.scrollTop = viewport.scrollHeight
          scrollTop = viewport.scrollTop
          scrollHeight = viewport.scrollHeight
        }

        if (
          scrollTop !== lastScrollTop
          || scrollHeight !== lastScrollHeight
          || viewportHeight !== lastViewportHeight
        ) {
          lastScrollTop = scrollTop
          lastScrollHeight = scrollHeight
          lastViewportHeight = viewportHeight
          const nextMetrics = {
            offset: scrollTop,
            scrollHeight,
            viewportHeight,
          }
          isAtBottomRef.current = readIsAtBottom(nextMetrics)
          writeChatAttentionSnapshot(nextMetrics)
          writeMinimapProgress(nextMetrics)
        }
      }

      frame = requestAnimationFrame(syncScrollObservers)
    }

    frame = requestAnimationFrame(syncScrollObservers)
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [writeChatAttentionSnapshot, writeMinimapProgress])

  const handleComposerFocusChange = useCallback((focused: boolean) => {
    updateChatAttentionSnapshot(sessionIdRef.current, {
      focusedArea: focused ? 'composer' : null,
      updatedAt: Date.now(),
    })
  }, [])

  useEffect(() => {
    const frame = requestAnimationFrame(refreshScrollMetrics)
    return () => cancelAnimationFrame(frame)
  }, [messageIds.length, refreshScrollMetrics])

  const scrollToMessageIndex = useCallback((index: number) => {
    const virtualizer = virtualizerRef.current
    const viewport = viewportRef.current
    if (!virtualizer || !viewport) {
      return
    }
    virtualizer.scrollToIndex(index, { align: 'start', smooth: true })
  }, [])

  const scrollToOffset = useCallback((offset: number) => {
    const viewport = viewportRef.current
    if (viewport) {
      viewport.scrollTop = offset
    }
  }, [])

  return {
    scrollContainerRef,
    viewportRef,
    virtualizerRef,
    minimapRef,
    keepMountedIndices,
    metrics,
    handleVirtualScroll,
    scrollToMessageIndex,
    scrollToOffset,
    handleComposerFocusChange,
  }
}
