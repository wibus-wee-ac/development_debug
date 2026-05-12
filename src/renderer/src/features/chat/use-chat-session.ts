// Input: @ai-sdk/react useChat, ipc-chat-transport, ipc.chat timeline queries, and chat timeline push events
// Output: useChatSession — renderer chat hook with local streaming plus passive snapshot recovery after reload
// Position: Feature hook for chat feature; renderer-side view layer bridging useChat with persisted timeline state

import { useChat } from '@ai-sdk/react'
import { ipc } from '@renderer/lib/ipc'
import type { ChatStatus, UIMessage } from 'ai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { projectEventsToAssistantMessage } from '../../../../shared/timeline-projection'
import { createIpcChatTransport } from './ipc-chat-transport'
import { useChatTimelineEvent } from './use-chat-events'

/** Timeline hydration row as returned by `ipc.chat.getSessionTimeline`. */
export type ChatTimelineGroupRow = Awaited<ReturnType<NonNullable<typeof ipc>['chat']['getSessionTimeline']>>[number]

export type PublicStatus = 'idle' | 'streaming' | 'error'

type ChatSnapshotState = {
  status: PublicStatus
  error?: string
}

function mapStatus(status: ChatStatus): PublicStatus {
  if (status === 'streaming' || status === 'submitted') {
    return 'streaming'
  }
  if (status === 'error') {
    return 'error'
  }
  return 'idle'
}

export function derivePassiveChatState(
  rows: Array<{ role: string, status: string, errorText?: string | null }>,
): ChatSnapshotState {
  if (rows.some(row => row.status === 'streaming')) {
    return { status: 'streaming' }
  }

  const failedAssistant = [...rows]
    .reverse()
    .find(row => row.role === 'assistant' && row.status === 'failed')

  if (failedAssistant) {
    return {
      status: 'error',
      error: failedAssistant.errorText ?? undefined,
    }
  }

  return { status: 'idle' }
}
export function resolveVisibleChatState(
  liveStatus: PublicStatus,
  passiveStatus: PublicStatus,
): PublicStatus {
  if (liveStatus === 'streaming' || liveStatus === 'error') {
    return liveStatus
  }
  return passiveStatus
}

export async function stopChatTurn(args: {
  chatSessionId: string | null
  chatStop: () => Promise<void> | void
  ipcAbort?: (chatSessionId: string) => Promise<void> | void
}): Promise<void> {
  const tasks: Promise<unknown>[] = [Promise.resolve(args.chatStop())]

  if (args.chatSessionId && args.ipcAbort) {
    tasks.push(
      Promise.resolve(args.ipcAbort(args.chatSessionId)).catch(() => {}),
    )
  }

  await Promise.allSettled(tasks)
}

/**
 * Stable, recognisable placeholder id used when no chat session is selected.
 * useChat needs an id on every render; we just avoid feeding it null/undefined
 * that would cause internal regeneration each render.
 */
const EMPTY_CHAT_ID = '__cradle_empty_chat__'
const STREAM_RENDER_THROTTLE_MS = 50
const SNAPSHOT_SYNC_DEBOUNCE_MS = 75

function projectTimelineGroup(group: ChatTimelineGroupRow): UIMessage {
  if (group.role === 'user') {
    return {
      id: group.messageId,
      role: 'user',
      parts: [{ type: 'text', text: group.userText ?? '' }],
    }
  }

  return projectEventsToAssistantMessage(group.messageId, group.events)
}

export function useChatSession(chatSessionId: string | null, options?: {
  /**
   * Pre-loaded timeline groups from a TanStack Router loader or similar source.
   * When provided, `isReady` is true immediately (no empty-state flash) and
   * the hook still re-fetches in the background for streaming + freshness.
   */
  initialTimelineGroups?: ChatTimelineGroupRow[]
}) {
  const { initialTimelineGroups } = options ?? {}

  const transport = useMemo(
    () => (chatSessionId ? createIpcChatTransport(chatSessionId) : undefined),
    [chatSessionId],
  )

  const cachedInitialMessages = useMemo(
    () => initialTimelineGroups?.map(projectTimelineGroup),
    [initialTimelineGroups],
  )

  const chat = useChat<UIMessage>({
    id: chatSessionId ?? EMPTY_CHAT_ID,
    transport,
    messages: cachedInitialMessages,
    // AI SDK emits one React update per chunk by default. Our chat view renders
    // markdown, motion, and tool blocks, so throttling prevents render storms.
    experimental_throttle: STREAM_RENDER_THROTTLE_MS,
    onError: (error) => {
      console.error('[useChatSession] useChat stream failed', {
        chatSessionId,
        error,
        message: error.message,
        stack: error.stack,
      })
    },
  })

  // useChat's helpers close over the latest state; stash in a ref so background
  // IPC callbacks always call the current versions without stale closures.
  const chatRef = useRef(chat)
  useEffect(() => {
    chatRef.current = chat
  }, [chat])

  // Lazily initialise — if a loader already provided timeline groups for THIS session, we
  // are ready before the first paint.  useState's initialiser runs exactly once
  // so this never causes an extra re-render when chatSessionId later changes.
  const [isReady, setIsReady] = useState(() => !!(chatSessionId && initialTimelineGroups))
  const [snapshotState, setSnapshotState] = useState<ChatSnapshotState>(() => initialTimelineGroups
    ? derivePassiveChatState(initialTimelineGroups)
    : { status: 'idle' })
  const snapshotSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const syncSnapshot = useCallback(async () => {
    if (!chatSessionId || !ipc) {
      return
    }

    // Project UIMessages from raw timeline events (sole hydration path)
    const timeline = await ipc.chat.getSessionTimeline(chatSessionId)
    if (timeline.length > 0) {
      const projected = timeline.map(projectTimelineGroup)
      chatRef.current.setMessages(projected)
      setSnapshotState(derivePassiveChatState(timeline))
    }
    else {
      chatRef.current.setMessages([])
      setSnapshotState({ status: 'idle' })
    }
    setIsReady(true)
  }, [chatSessionId])

  const scheduleSnapshotSync = useCallback((delay = SNAPSHOT_SYNC_DEBOUNCE_MS) => {
    if (snapshotSyncTimerRef.current) {
      clearTimeout(snapshotSyncTimerRef.current)
    }

    snapshotSyncTimerRef.current = setTimeout(() => {
      snapshotSyncTimerRef.current = null
      void syncSnapshot().catch(() => {})
    }, delay)
  }, [syncSnapshot])

  // Initial load + passive recovery if a draft is already streaming.
  // We intentionally hydrate from the persisted DB snapshot instead of calling
  // useChat.resumeStream() after reload. The AI SDK stream assembler requires
  // the original text-start envelope, which a mid-flight reconnect cannot
  // reliably replay. Passive observation keeps the UI truthful without corrupting
  // the resumed message state.
  useEffect(() => {
    if (!chatSessionId || !ipc) {
      if (snapshotSyncTimerRef.current) {
        clearTimeout(snapshotSyncTimerRef.current)
        snapshotSyncTimerRef.current = null
      }
      chatRef.current.setMessages([])
      setIsReady(false)
      setSnapshotState({ status: 'idle' })
      return
    }

    // If we have pre-loaded timeline groups for this exact session we are already ready —
    // do NOT reset to false before the fetch completes (that is the flash).
    if (!initialTimelineGroups) {
      setIsReady(false)
    }

    let cancelled = false
    void syncSnapshot()
      .catch(() => {
        if (!cancelled) {
          setIsReady(false)
          setSnapshotState({ status: 'idle' })
        }
      })

    return () => {
      cancelled = true
      if (snapshotSyncTimerRef.current) {
        clearTimeout(snapshotSyncTimerRef.current)
        snapshotSyncTimerRef.current = null
      }
    }
  }, [chatSessionId, initialTimelineGroups, syncSnapshot])

  // Covers the passive observer case (reload, secondary window, or route remount).
  // When this renderer is not the one actively assembling the stream, we mirror
  // the persisted DB snapshot on response events so the UI stays accurate.
  useChatTimelineEvent(chatSessionId, (data) => {
    const currentStatus = chatRef.current.status

    // Always capture run.failed error text regardless of stream state.
    // AI SDK may not reliably surface the error message from controller.error(),
    // so we preserve the backend error in snapshotState as a fallback.
    if (data.event.type === 'run.failed') {
      const error = data.event.error || undefined
      setSnapshotState({ status: 'error', error })
      if (currentStatus !== 'streaming' && currentStatus !== 'submitted') {
        scheduleSnapshotSync(0)
      }
      return
    }

    if (currentStatus === 'streaming' || currentStatus === 'submitted') {
      // Locally driving — useChat is already assembling this turn
      return
    }

    switch (data.event.type) {
      case 'run.completed':
      case 'run.aborted': {
        setSnapshotState({ status: 'idle' })
        scheduleSnapshotSync(0)
        return
      }
      default: {
        setSnapshotState({ status: 'streaming' })
        scheduleSnapshotSync()
      }
    }
  })

  useEffect(() => {
    if (!chat.error) {
      return
    }
    console.error('[useChatSession] chat.error updated', {
      chatSessionId,
      error: chat.error,
      message: chat.error.message,
      stack: chat.error.stack,
    })
  }, [chatSessionId, chat.error])

  const sendMessage = useCallback(
    async (text: string) => {
      if (!chatSessionId) {
        return
      }
      await chat.sendMessage({ text })
    },
    [chatSessionId, chat],
  )

  const stop = useCallback(() => {
    void stopChatTurn({
      chatSessionId,
      chatStop: chat.stop,
      ipcAbort: ipc?.chat.abort,
    })
  }, [chat.stop, chatSessionId])

  const liveStatus = mapStatus(chat.status)
  const visibleStatus = resolveVisibleChatState(liveStatus, snapshotState.status)
  const visibleError = liveStatus === 'error'
    ? (chat.error?.message || snapshotState.error)
    : snapshotState.error

  return {
    messages: chat.messages,
    status: visibleStatus,
    error: visibleError,
    sendMessage,
    stop,
    isReady,
  }
}
