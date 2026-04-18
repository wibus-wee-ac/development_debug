// Input: useChat from @ai-sdk/react, AcpChatTransport, ipc for persistence
// Output: useChatSession hook — wraps useChat with ACP transport + DB persistence
// Position: Data hook for chat feature, bridges AI SDK, ACP IPC layer, and DB

import { useChat } from '@ai-sdk/react'
import { AcpChatTransport } from '@renderer/lib/acp-chat-transport'
import { ipc } from '@renderer/lib/ipc'
import type { UIMessage } from 'ai'
import { useCallback, useEffect, useMemo, useRef } from 'react'

interface UseChatSessionOptions {
  agentId: string | null
  sessionId: string | null
}

/**
 * Serialize a UIMessage into a JSON string for DB storage.
 * Store the full parts array so we can restore reasoning / tool-call blocks.
 */
function serializeMessage(msg: UIMessage): string {
  return JSON.stringify({ id: msg.id, role: msg.role, parts: msg.parts })
}

/**
 * Deserialize a DB row content string back into a UIMessage.
 */
function deserializeMessage(content: string, fallbackRole: 'user' | 'assistant'): UIMessage | null {
  try {
    const parsed = JSON.parse(content) as { id?: string, role?: string, parts?: unknown[] }
    if (parsed.parts && Array.isArray(parsed.parts)) {
      return {
        id: parsed.id ?? crypto.randomUUID(),
        role: (parsed.role as UIMessage['role']) ?? fallbackRole,
        parts: parsed.parts as UIMessage['parts'],
        createdAt: new Date(),
      }
    }
  }
  catch {
    // Fallback: treat content as plain text
  }
  return {
    id: crypto.randomUUID(),
    role: fallbackRole,
    parts: [{ type: 'text', text: content }],
    createdAt: new Date(),
  }
}

export function useChatSession({ agentId, sessionId }: UseChatSessionOptions) {
  const transport = useMemo(() => {
    if (!agentId || !sessionId) {
      return null
    }
    return new AcpChatTransport({ agentId, sessionId })
  }, [agentId, sessionId])

  const chat = useChat({
    id: sessionId ?? undefined,
    transport: transport ?? undefined,
  })

  const { setMessages } = chat

  // Track which messages have been persisted to avoid duplicates
  const persistedIdsRef = useRef(new Set<string>())

  // Load persisted messages from DB when session changes
  useEffect(() => {
    if (!sessionId) {
      return
    }

    let cancelled = false

    async function loadMessages() {
      try {
        const rows = await ipc!.session.getMessages(sessionId!)
        if (cancelled || rows.length === 0) {
          return
        }

        const restored: UIMessage[] = rows
          .map(row => deserializeMessage(row.content, row.role as 'user' | 'assistant'))
          .filter((m): m is UIMessage => m !== null)

        // Mark all restored messages as already persisted
        for (const msg of restored) {
          persistedIdsRef.current.add(msg.id)
        }

        setMessages(restored)
      }
      catch {
        // DB read failed — start with empty conversation
      }
    }

    persistedIdsRef.current.clear()
    loadMessages()

    return () => {
      cancelled = true
    }
  }, [sessionId, setMessages])

  // Persist new messages to DB
  const persistMessages = useCallback(
    async (msgs: UIMessage[]) => {
      if (!sessionId) {
        return
      }

      for (const msg of msgs) {
        if (persistedIdsRef.current.has(msg.id)) {
          continue
        }

        // Only persist user + assistant messages
        if (msg.role !== 'user' && msg.role !== 'assistant') {
          continue
        }

        try {
          await ipc!.session.addMessage({
            sessionId,
            role: msg.role,
            content: serializeMessage(msg),
          })
          persistedIdsRef.current.add(msg.id)
        }
        catch {
          // Silently ignore persistence errors
        }
      }
    },
    [sessionId],
  )

  // Watch for status changes — persist when streaming finishes
  const prevStatusRef = useRef(chat.status)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = chat.status

    // When transitioning from streaming/submitted to ready, persist all messages
    if (
      (prev === 'streaming' || prev === 'submitted')
      && chat.status === 'ready'
    ) {
      persistMessages(chat.messages)
    }
  }, [chat.status, chat.messages, persistMessages])

  // Also persist user messages immediately on send
  const originalSendMessage = chat.sendMessage
  const wrappedSendMessage = useCallback(
    async (...args: Parameters<typeof originalSendMessage>) => {
      const result = await originalSendMessage(...args)
      // After sendMessage, the user message is in chat.messages — persist it
      // We use a microtask to let React state update
      queueMicrotask(() => {
        persistMessages(chat.messages)
      })
      return result
    },
    [originalSendMessage, persistMessages, chat.messages],
  )

  return {
    ...chat,
    sendMessage: wrappedSendMessage,
    isReady: !!transport,
  }
}
