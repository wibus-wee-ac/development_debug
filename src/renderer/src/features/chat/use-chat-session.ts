// Input: ChatSessionManager zustand store
// Output: useChatSession — thin reactive subscriber to the protocol-driven manager
// Position: Data hook for chat feature, bridges ChatSessionManager state to React components

import { useCallback, useEffect } from 'react'

import { useChatSessionManager } from './chat-session-manager'

export function useChatSession(sessionId: string | null) {
  const { sessions, loadSession, sendMessage, stop } = useChatSessionManager()

  // Load session from DB on mount (if not already in memory)
  useEffect(() => {
    if (sessionId) {
      loadSession(sessionId)
    }
  }, [sessionId, loadSession])

  const session = sessionId ? sessions[sessionId] : null

  const send = useCallback(
    (text: string, cwd?: string) => {
      if (sessionId) {
        sendMessage(sessionId, text, cwd)
      }
    },
    [sessionId, sendMessage],
  )

  const handleStop = useCallback(() => {
    if (sessionId) {
      stop(sessionId)
    }
  }, [sessionId, stop])

  return {
    messages: session?.messages ?? [],
    status: session?.status ?? 'idle',
    error: session?.error,
    sendMessage: send,
    stop: handleStop,
    isReady: !!session,
  }
}
