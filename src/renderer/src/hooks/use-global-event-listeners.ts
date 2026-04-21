// Input: window.ptyPush, window.electron.ipcRenderer, session-activity store, TanStack Router matchRoute
// Output: useGlobalEventListeners hook — registers PTY and chat event listeners for unread tracking
// Position: Called once at the AppLayout level; centralises all side-effect subscriptions for main-window events

import { useSessionActivityStore } from '@renderer/store/session-activity'
import { useMatchRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

export function useGlobalEventListeners() {
  const markUnread = useSessionActivityStore(s => s.markUnread)
  const matchRoute = useMatchRoute()

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
  useEffect(() => {
    const off = window.electron.ipcRenderer.on(
      'chat:response-event',
      (_: unknown, data: { chatSessionId: string, event: { type: string } }) => {
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
      },
    )
    return off
  }, [markUnread, matchRoute])
}
