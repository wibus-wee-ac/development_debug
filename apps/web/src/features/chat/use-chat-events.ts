// Input: unified signal bridge (window.cradle.subscribe), ChatTimelineEventPayload, ChatSessionTitlePayload, ChatSessionActivityPayload
// Output: useChatTimelineEvent, useGlobalChatSessionActivityEvent, useChatSessionTitle hooks
// Position: Unified chat event bridge — single subscription, multi-consumer dispatch

import type {
  ChatSessionActivityPayload,
  ChatSessionTitlePayload,
  ChatTimelineEventPayload,
} from '@shared/chat-events'
import { useEffect, useRef } from 'react'

import { subscribe } from '~/lib/signal'

/* ─── Module-level handler registries ────────────────────── */

type TimelineHandler = (payload: ChatTimelineEventPayload) => void
type ActivityHandler = (payload: ChatSessionActivityPayload) => void
type TitleHandler = (payload: ChatSessionTitlePayload) => void

const timelineHandlers = new Set<TimelineHandler>()
const activityHandlers = new Set<ActivityHandler>()
const titleHandlers = new Set<TitleHandler>()

let timelineUnsub: (() => void) | null = null
let activityUnsub: (() => void) | null = null
let titleUnsub: (() => void) | null = null

function ensureTimelineSubscription(): void {
  if (timelineUnsub) {
    return
  }
  timelineUnsub = subscribe('chat:timeline-event', (payload) => {
    for (const handler of timelineHandlers) {
      handler(payload)
    }
  })
}

function ensureActivitySubscription(): void {
  if (activityUnsub) {
    return
  }
  activityUnsub = subscribe('chat:session-activity', (payload) => {
    for (const handler of activityHandlers) {
      handler(payload)
    }
  })
}

function ensureTitleSubscription(): void {
  if (titleUnsub) {
    return
  }
  titleUnsub = subscribe('chat:session-title', (payload) => {
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
 * Subscribe to all terminal chat activity events regardless of session.
 */
export function useGlobalChatSessionActivityEvent(handler: ActivityHandler): void {
  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  })

  useEffect(() => {
    const wrapped: ActivityHandler = (payload) => {
      handlerRef.current(payload)
    }

    activityHandlers.add(wrapped)
    ensureActivitySubscription()

    return () => {
      activityHandlers.delete(wrapped)
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
