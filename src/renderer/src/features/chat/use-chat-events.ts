// Input: chatPush preload API, ChatTimelineEventPayload, ChatSessionTitlePayload
// Output: useChatTimelineEvent, useGlobalChatTimelineEvent, useChatSessionTitle hooks
// Position: Unified chat event bridge — single subscription, multi-consumer dispatch

import type { ChatSessionTitlePayload, ChatTimelineEventPayload } from '@shared/chat-events'
import { useEffect, useRef } from 'react'

/* ─── Module-level handler registries ────────────────────── */

type TimelineHandler = (payload: ChatTimelineEventPayload) => void
type TitleHandler = (payload: ChatSessionTitlePayload) => void

const timelineHandlers = new Set<TimelineHandler>()
const titleHandlers = new Set<TitleHandler>()

let timelineUnsub: (() => void) | null = null
let titleUnsub: (() => void) | null = null

function ensureTimelineSubscription(): void {
  if (timelineUnsub) {
    return
  }
  timelineUnsub = window.chatPush.onTimelineEvent((payload) => {
    for (const handler of timelineHandlers) {
      handler(payload)
    }
  })
}

function ensureTitleSubscription(): void {
  if (titleUnsub) {
    return
  }
  titleUnsub = window.chatPush.onSessionTitle((payload) => {
    for (const handler of titleHandlers) {
      handler(payload)
    }
  })
}

/* ─── Hooks ──────────────────────────────────────────────── */

/**
 * Subscribe to chat timeline events for a specific session.
 * The handler is called only when `payload.chatSessionId === sessionId`.
 */
export function useChatTimelineEvent(
  sessionId: string | null | undefined,
  handler: TimelineHandler,
): void {
  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  })

  useEffect(() => {
    if (!sessionId) {
      return
    }

    const wrapped: TimelineHandler = (payload) => {
      if (payload.chatSessionId === sessionId) {
        handlerRef.current(payload)
      }
    }

    timelineHandlers.add(wrapped)
    ensureTimelineSubscription()

    return () => {
      timelineHandlers.delete(wrapped)
    }
  }, [sessionId])
}

/**
 * Subscribe to all chat timeline events regardless of session.
 */
export function useGlobalChatTimelineEvent(handler: TimelineHandler): void {
  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  })

  useEffect(() => {
    const wrapped: TimelineHandler = (payload) => {
      handlerRef.current(payload)
    }

    timelineHandlers.add(wrapped)
    ensureTimelineSubscription()

    return () => {
      timelineHandlers.delete(wrapped)
    }
  }, [])
}

/**
 * Subscribe to session title updates for a specific session.
 */
export function useChatSessionTitle(
  sessionId: string | null | undefined,
  handler: (title: string) => void,
): void {
  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  })

  useEffect(() => {
    if (!sessionId) {
      return
    }

    const wrapped: TitleHandler = (payload) => {
      if (payload.chatSessionId === sessionId) {
        handlerRef.current(payload.title)
      }
    }

    titleHandlers.add(wrapped)
    ensureTitleSubscription()

    return () => {
      titleHandlers.delete(wrapped)
    }
  }, [sessionId])
}
