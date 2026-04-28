// Input: window.ptyPush, chatPush (via useGlobalChatEvent), session-activity store, layout store, tab store
// Output: useGlobalEventListeners hook — registers PTY, chat event listeners, and panel keyboard shortcuts
// Position: Called once at the AppLayout level; centralises all side-effect subscriptions for main-window events

import { useGlobalChatEvent } from '@renderer/features/chat/use-chat-events'
import { useLayoutStore } from '@renderer/store/layout'
import { useSessionActivityStore } from '@renderer/store/session-activity'
import { useCradleTabStore } from '@renderer/tabs/registry'
import { useEffect } from 'react'

/**
 * Check if a given session is currently the active tab.
 * Uses the store snapshot directly — safe to call from event handlers.
 */
function isSessionActive(sessionId: string): boolean {
  const { tabs, activeTabId } = useCradleTabStore.getState()
  const active = tabs.find(t => t.id === activeTabId)
  return active?.type === 'chat' && active.params.sessionId === sessionId
}

export function useGlobalEventListeners() {
  const markUnread = useSessionActivityStore(s => s.markUnread)
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
      if (!isSessionActive(sessionId)) {
        markUnread(sessionId)
      }
      if ('Notification' in window && Notification.permission === 'granted') {
        void new Notification('Cradle', { body: message || '通知' })
      }
    })

    const unsubExit = window.ptyPush.onExit((sessionId) => {
      if (!isSessionActive(sessionId)) {
        markUnread(sessionId)
      }
    })

    const unsubCommandFinish = window.ptyPush.onCommandFinish((sessionId) => {
      if (!isSessionActive(sessionId)) {
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
  }, [markUnread])

  // Chat response events: mark unread when a response completes in an inactive session
  useGlobalChatEvent((data) => {
    if (
      data.event.type !== 'response.completed'
      && data.event.type !== 'response.failed'
    ) {
      return
    }
    if (!isSessionActive(data.chatSessionId)) {
      markUnread(data.chatSessionId)
    }
  })
}
