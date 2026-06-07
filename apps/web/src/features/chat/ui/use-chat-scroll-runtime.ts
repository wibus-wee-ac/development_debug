// Chat-owned scroll controller for virtualized session transcripts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { VirtualizerHandle } from 'virtua'
import { useShallow } from 'zustand/react/shallow'

import { useChatStore } from '~/store/chat'

import { clearChatAttentionSnapshot, installChatContextProvider, updateChatAttentionSnapshot } from '../context/chat-context'
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
const BOTTOM_PROXIMITY_PX = 8

function readScrollRatio(metrics: ChatScrollMetrics): number {
  const scrollable = Math.max(metrics.scrollHeight - metrics.viewportHeight, 0)
  return scrollable > 0 ? metrics.offset / scrollable : 1
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
  const shouldFollowBottomRef = useRef(true)
  const initialScrollDoneRef = useRef(false)
  const messageIdsRef = useRef(messageIds)
  const sessionIdRef = useRef(sessionId)
  const metricsRef = useRef<ChatScrollMetrics>(EMPTY_SCROLL_METRICS)
  const minimapRafIdRef = useRef(0)
  const followBottomRafIdRef = useRef(0)
  const initialBottomRafIdRef = useRef(0)
  const programmaticScrollRafIdRef = useRef(0)
  const isProgrammaticScrollRef = useRef(false)
  const lastScrollOffsetRef = useRef(0)
  const lastTouchYRef = useRef<number | null>(null)
  const [metrics, setMetrics] = useState<ChatScrollMetrics>(EMPTY_SCROLL_METRICS)

  useEffect(() => {
    messageIdsRef.current = messageIds
  }, [messageIds])

  useEffect(() => {
    if (initialBottomRafIdRef.current !== 0) {
      cancelAnimationFrame(initialBottomRafIdRef.current)
    }
    if (followBottomRafIdRef.current !== 0) {
      cancelAnimationFrame(followBottomRafIdRef.current)
    }
    if (programmaticScrollRafIdRef.current !== 0) {
      cancelAnimationFrame(programmaticScrollRafIdRef.current)
    }
    sessionIdRef.current = sessionId
    initialScrollDoneRef.current = false
    isAtBottomRef.current = true
    shouldFollowBottomRef.current = true
    initialBottomRafIdRef.current = 0
    followBottomRafIdRef.current = 0
    programmaticScrollRafIdRef.current = 0
    isProgrammaticScrollRef.current = false
    lastScrollOffsetRef.current = 0
    lastTouchYRef.current = null
    metricsRef.current = EMPTY_SCROLL_METRICS
    setMetrics(EMPTY_SCROLL_METRICS)
    minimapRef.current?.setActiveMessageIndex(0)
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

  const scheduleMinimapSync = useCallback((nextMetrics: ChatScrollMetrics) => {
    metricsRef.current = nextMetrics
    writeChatAttentionSnapshot(nextMetrics)
    const virtualizer = virtualizerRef.current
    const currentMessageIds = messageIdsRef.current
    if (virtualizer && currentMessageIds.length > 0) {
      const activeMessageIndex = Math.max(
        0,
        Math.min(currentMessageIds.length - 1, virtualizer.findItemIndex(nextMetrics.offset)),
      )
      minimapRef.current?.setActiveMessageIndex(activeMessageIndex)
    }

    // Throttle React state update to one per frame (for ChatMinimap consumers)
    if (minimapRafIdRef.current === 0) {
      minimapRafIdRef.current = requestAnimationFrame(() => {
        minimapRafIdRef.current = 0
        setMetrics(metricsRef.current)
      })
    }
  }, [writeChatAttentionSnapshot])

  const cancelScheduledFollowBottom = useCallback(() => {
    if (followBottomRafIdRef.current !== 0) {
      cancelAnimationFrame(followBottomRafIdRef.current)
      followBottomRafIdRef.current = 0
    }
  }, [])

  const cancelInitialBottomScroll = useCallback(() => {
    if (initialBottomRafIdRef.current !== 0) {
      cancelAnimationFrame(initialBottomRafIdRef.current)
      initialBottomRafIdRef.current = 0
    }
  }, [])

  const clearProgrammaticScroll = useCallback(() => {
    if (programmaticScrollRafIdRef.current !== 0) {
      cancelAnimationFrame(programmaticScrollRafIdRef.current)
      programmaticScrollRafIdRef.current = 0
    }
    isProgrammaticScrollRef.current = false
  }, [])

  const markProgrammaticScroll = useCallback(() => {
    if (programmaticScrollRafIdRef.current !== 0) {
      cancelAnimationFrame(programmaticScrollRafIdRef.current)
    }
    isProgrammaticScrollRef.current = true
    programmaticScrollRafIdRef.current = requestAnimationFrame(() => {
      programmaticScrollRafIdRef.current = requestAnimationFrame(() => {
        programmaticScrollRafIdRef.current = 0
        isProgrammaticScrollRef.current = false
      })
    })
  }, [])

  const detachFromBottomFollow = useCallback(() => {
    shouldFollowBottomRef.current = false
    cancelInitialBottomScroll()
    cancelScheduledFollowBottom()
  }, [cancelInitialBottomScroll, cancelScheduledFollowBottom])

  const commitScrollMetrics = useCallback((nextMetrics: ChatScrollMetrics, options?: { source?: 'layout' | 'programmatic' | 'scroll' }) => {
    const scrolledUp = nextMetrics.offset < lastScrollOffsetRef.current - 1
    const isAtBottom = readIsAtBottom(nextMetrics)
    const isUserScroll = options?.source === 'scroll' && !isProgrammaticScrollRef.current

    isAtBottomRef.current = isAtBottom
    if (isUserScroll && scrolledUp) {
      detachFromBottomFollow()
    }
    else if (isAtBottom && !scrolledUp) {
      shouldFollowBottomRef.current = true
    }

    lastScrollOffsetRef.current = nextMetrics.offset
    scheduleMinimapSync(nextMetrics)
  }, [detachFromBottomFollow, scheduleMinimapSync])

  const scrollToBottom = useCallback(() => {
    const viewport = viewportRef.current
    if (viewport) {
      markProgrammaticScroll()
      viewport.scrollTop = viewport.scrollHeight
      isAtBottomRef.current = true
      shouldFollowBottomRef.current = true
      lastScrollOffsetRef.current = viewport.scrollTop
    }
  }, [markProgrammaticScroll])

  const scheduleFollowBottom = useCallback(() => {
    if (followBottomRafIdRef.current !== 0) {
      return
    }

    followBottomRafIdRef.current = requestAnimationFrame(() => {
      followBottomRafIdRef.current = 0
      if (!shouldFollowBottomRef.current) {
        return
      }

      scrollToBottom()
      const nextMetrics = readScrollMetrics()
      if (nextMetrics) {
        commitScrollMetrics(nextMetrics, { source: 'programmatic' })
      }
    })
  }, [commitScrollMetrics, readScrollMetrics, scrollToBottom])

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
    shouldFollowBottomRef.current = true
    initialBottomRafIdRef.current = requestAnimationFrame(() => {
      initialBottomRafIdRef.current = 0
      if (!shouldFollowBottomRef.current) {
        return
      }
      scrollToBottom()
      scheduleFollowBottom()
    })
  }, [messageIds.length, scheduleFollowBottom, scrollToBottom])

  useEffect(() => {
    if (!shouldFollowBottomRef.current) {
      return
    }

    scheduleFollowBottom()
  }, [messageIds.length, status, scheduleFollowBottom])

  const handleVirtualScroll = useCallback((offset: number) => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    commitScrollMetrics({
      offset,
      scrollHeight: viewport.scrollHeight,
      viewportHeight: viewport.offsetHeight,
    }, { source: 'scroll' })
  }, [commitScrollMetrics])

  const syncCurrentMetrics = useCallback(() => {
    const nextMetrics = readScrollMetrics()
    if (nextMetrics) {
      commitScrollMetrics(nextMetrics)
    }
  }, [commitScrollMetrics, readScrollMetrics])

  const handleTranscriptLayoutChange = useCallback(() => {
    if (shouldFollowBottomRef.current) {
      scheduleFollowBottom()
      return
    }

    syncCurrentMetrics()
  }, [scheduleFollowBottom, syncCurrentMetrics])

  const getTranscriptContentElement = useCallback(() => {
    const viewport = viewportRef.current
    return viewport?.firstElementChild instanceof HTMLElement
      ? viewport.firstElementChild
      : null
  }, [])

  // Event-driven scroll observation — replaces the rAF loop
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }

    let lastScrollHeight = viewport.scrollHeight
    let observedTranscriptContent: HTMLElement | null = null
    let transcriptMutationFrameId = 0

    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        detachFromBottomFollow()
      }
    }

    const onTouchStart = (event: TouchEvent) => {
      lastTouchYRef.current = event.touches[0]?.clientY ?? null
    }

    const onTouchMove = (event: TouchEvent) => {
      const nextTouchY = event.touches[0]?.clientY ?? null
      const lastTouchY = lastTouchYRef.current
      if (nextTouchY !== null && lastTouchY !== null && nextTouchY > lastTouchY + 1) {
        detachFromBottomFollow()
      }
      lastTouchYRef.current = nextTouchY
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Home') {
        detachFromBottomFollow()
      }
    }

    const onScroll = () => {
      commitScrollMetrics({
        offset: viewport.scrollTop,
        scrollHeight: viewport.scrollHeight,
        viewportHeight: viewport.offsetHeight,
      }, { source: 'scroll' })
    }

    const onResize = () => {
      const scrollHeight = viewport.scrollHeight
      const viewportHeight = viewport.offsetHeight

      if (scrollHeight !== lastScrollHeight) {
        handleTranscriptLayoutChange()
      }
      lastScrollHeight = scrollHeight

      commitScrollMetrics({ offset: viewport.scrollTop, scrollHeight: viewport.scrollHeight, viewportHeight }, { source: 'layout' })
    }

    const resizeObserver = new ResizeObserver(onResize)

    const observeTranscriptContent = () => {
      const transcriptContent = getTranscriptContentElement()
      if (transcriptContent === observedTranscriptContent) {
        return
      }
      if (observedTranscriptContent) {
        resizeObserver.unobserve(observedTranscriptContent)
      }
      observedTranscriptContent = transcriptContent
      if (observedTranscriptContent) {
        resizeObserver.observe(observedTranscriptContent)
      }
    }

    const flushTranscriptMutation = () => {
      transcriptMutationFrameId = 0
      observeTranscriptContent()
      handleTranscriptLayoutChange()
    }

    const onTranscriptMutation = () => {
      if (transcriptMutationFrameId !== 0) {
        return
      }
      transcriptMutationFrameId = requestAnimationFrame(flushTranscriptMutation)
    }

    viewport.addEventListener('wheel', onWheel, { capture: true, passive: true })
    viewport.addEventListener('touchstart', onTouchStart, { capture: true, passive: true })
    viewport.addEventListener('touchmove', onTouchMove, { capture: true, passive: true })
    viewport.addEventListener('keydown', onKeyDown, { capture: true })
    viewport.addEventListener('scroll', onScroll, { passive: true })
    resizeObserver.observe(viewport)
    observeTranscriptContent()

    const mutationObserver = new MutationObserver(onTranscriptMutation)
    mutationObserver.observe(viewport, {
      childList: true,
      subtree: true,
    })

    syncCurrentMetrics()

    return () => {
      viewport.removeEventListener('wheel', onWheel, { capture: true })
      viewport.removeEventListener('touchstart', onTouchStart, { capture: true })
      viewport.removeEventListener('touchmove', onTouchMove, { capture: true })
      viewport.removeEventListener('keydown', onKeyDown, { capture: true })
      viewport.removeEventListener('scroll', onScroll)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      if (transcriptMutationFrameId !== 0) {
        cancelAnimationFrame(transcriptMutationFrameId)
        transcriptMutationFrameId = 0
      }
      if (minimapRafIdRef.current !== 0) {
        cancelAnimationFrame(minimapRafIdRef.current)
        minimapRafIdRef.current = 0
      }
      if (followBottomRafIdRef.current !== 0) {
        cancelScheduledFollowBottom()
      }
      if (initialBottomRafIdRef.current !== 0) {
        cancelInitialBottomScroll()
      }
      clearProgrammaticScroll()
    }
  }, [
    cancelInitialBottomScroll,
    cancelScheduledFollowBottom,
    clearProgrammaticScroll,
    commitScrollMetrics,
    detachFromBottomFollow,
    getTranscriptContentElement,
    handleTranscriptLayoutChange,
    syncCurrentMetrics,
  ])

  const handleComposerFocusChange = useCallback((focused: boolean) => {
    updateChatAttentionSnapshot(sessionIdRef.current, {
      focusedArea: focused ? 'composer' : null,
      updatedAt: Date.now(),
    })
  }, [])

  useEffect(() => {
    syncCurrentMetrics()
  }, [messageIds.length, syncCurrentMetrics])

  const scrollToMessageIndex = useCallback((index: number) => {
    const virtualizer = virtualizerRef.current
    const viewport = viewportRef.current
    if (!virtualizer || !viewport) {
      return
    }
    shouldFollowBottomRef.current = false
    markProgrammaticScroll()
    virtualizer.scrollToIndex(index, { align: 'start', smooth: true })
  }, [markProgrammaticScroll])

  const scrollToOffset = useCallback((offset: number) => {
    const viewport = viewportRef.current
    if (viewport) {
      shouldFollowBottomRef.current = offset + viewport.offsetHeight >= viewport.scrollHeight - BOTTOM_PROXIMITY_PX
      markProgrammaticScroll()
      viewport.scrollTop = offset
    }
  }, [markProgrammaticScroll])

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
