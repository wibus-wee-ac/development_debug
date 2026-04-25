// Input: chatPush preload API, ChatResponseEventPayload, ChatSessionTitlePayload
// Output: useChatResponseEvent, useGlobalChatEvent, useChatSessionTitle hooks
// Position: Unified chat event bridge — single subscription, multi-consumer dispatch

import type { ChatResponseEventPayload, ChatSessionTitlePayload } from '@shared/chat-events'
import { useEffect, useRef } from 'react'

/* ─── Module-level handler registries ────────────────────── */

type ResponseHandler = (payload: ChatResponseEventPayload) => void
type TitleHandler = (payload: ChatSessionTitlePayload) => void

const responseHandlers = new Set<ResponseHandler>()
const titleHandlers = new Set<TitleHandler>()

let responseUnsub: (() => void) | null = null
let titleUnsub: (() => void) | null = null

function ensureResponseSubscription(): void {
  if (responseUnsub) {
    return
  }
  responseUnsub = window.chatPush.onResponseEvent((payload) => {
    for (const handler of responseHandlers) {
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
 * Subscribe to chat response events for a specific session.
 * The handler is called only when `payload.chatSessionId === sessionId`.
 */
export function useChatResponseEvent(
  sessionId: string | null | undefined,
  handler: ResponseHandler,
): void {
  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  })

  useEffect(() => {
    if (!sessionId) {
      return
    }

    const wrapped: ResponseHandler = (payload) => {
      if (payload.chatSessionId === sessionId) {
        handlerRef.current(payload)
      }
    }

    responseHandlers.add(wrapped)
    ensureResponseSubscription()

    return () => {
      responseHandlers.delete(wrapped)
    }
  }, [sessionId])
}

/**
 * Subscribe to all chat response events regardless of session.
 */
export function useGlobalChatEvent(handler: ResponseHandler): void {
  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  })

  useEffect(() => {
    const wrapped: ResponseHandler = (payload) => {
      handlerRef.current(payload)
    }

    responseHandlers.add(wrapped)
    ensureResponseSubscription()

    return () => {
      responseHandlers.delete(wrapped)
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
