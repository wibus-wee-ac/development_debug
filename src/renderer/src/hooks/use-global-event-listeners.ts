// Input: window.ptyPush, chatPush (via useGlobalChatEvent), session-activity store, layout store, TanStack Router matchRoute
// Output: useGlobalEventListeners hook — registers PTY, chat event listeners, and panel keyboard shortcuts
// Position: Called once at the AppLayout level; centralises all side-effect subscriptions for main-window events

import { useGlobalChatEvent } from '@renderer/features/chat/use-chat-events'
import { useLayoutStore } from '@renderer/store/layout'
import { useSessionActivityStore } from '@renderer/store/session-activity'
import { useMatchRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

export function useGlobalEventListeners() {
  const markUnread = useSessionActivityStore(s => s.markUnread)
  const matchRoute = useMatchRoute()
  const toggleBottomPanel = useLayoutStore(s => s.toggleBottomPanel)
  const toggleAside = useLayoutStore(s => s.toggleAside)

  // Panel keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ctrl+` → toggle bottom panel
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === '`') {
        e.preventDefault()
        toggleBottomPanel()
        return
      }
      // Cmd+Option+B → toggle right aside (e.key is '∫' on macOS when Option is held)
      if (e.metaKey && e.altKey && !e.ctrlKey && (e.key === 'b' || e.key === 'B' || e.key === '∫')) {
        e.preventDefault()
        toggleAside()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleBottomPanel, toggleAside])

  // PTY notifications: OSC 9, exit, OSC 133;D
  useEffect(() => {
    const unsubNotify = window.ptyPush.onNotification((sessionId, message) => {
      const isActive = !!matchRoute({ to: '/chat/$sessionId', params: { sessionId } })
      if (!isActive) {
        markUnread(sessionId)
      }
      if ('Notification' in window && Notification.permission === 'granted') {
        void new Notification('Cradle', { body: message || '通知' })
      }
    })

    const unsubExit = window.ptyPush.onExit((sessionId) => {
      const isActive = !!matchRoute({ to: '/chat/$sessionId', params: { sessionId } })
      if (!isActive) {
        markUnread(sessionId)
      }
    })

    const unsubCommandFinish = window.ptyPush.onCommandFinish((sessionId) => {
      const isActive = !!matchRoute({ to: '/chat/$sessionId', params: { sessionId } })
      if (!isActive) {
        markUnread(sessionId)
        if ('Notification' in window && Notification.permission === 'granted') {
          void new Notification('Cradle', { body: '命令执行完成' })
        }
      }
    })

    return () => {
      unsubNotify()
      unsubExit()
      unsubCommandFinish()
    }
  }, [markUnread, matchRoute])

  // Chat response events: mark unread when a response completes in an inactive session
  useGlobalChatEvent((data) => {
    if (
      data.event.type !== 'response.completed'
      && data.event.type !== 'response.failed'
    ) {
      return
    }
    const isActive = !!matchRoute({
      to: '/chat/$sessionId',
      params: { sessionId: data.chatSessionId },
    })
    if (!isActive) {
      markUnread(data.chatSessionId)
    }
  })
}
