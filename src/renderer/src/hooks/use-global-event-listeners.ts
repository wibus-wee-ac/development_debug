// Input: unified signal bridge, chat activity hooks, session-activity store, layout store, and tab store
// Output: useGlobalEventListeners hook — registers PTY, chat event listeners, and panel keyboard shortcuts
// Position: Called once at the AppLayout level; centralises all side-effect subscriptions for main-window events

import { useGlobalChatSessionActivityEvent } from '@renderer/features/chat/use-chat-events'
import { subscribe } from '@renderer/lib/signal'
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

  // Panel + tab keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isBackquote = e.key === '`' || e.code === 'Backquote'
      const isKeyB = e.key === 'b' || e.key === 'B' || e.key === '∫' || e.code === 'KeyB'

      // Ctrl+` → toggle bottom panel
      if (e.ctrlKey && !e.metaKey && !e.altKey && isBackquote) {
        e.preventDefault()
        toggleBottomPanel()
        return
      }
      // Cmd+Option+B → toggle right aside (e.key is '∫' on macOS when Option is held)
      if (e.metaKey && e.altKey && !e.ctrlKey && isKeyB) {
        e.preventDefault()
        toggleAside()
        return
      }

      // ── Tab shortcuts ──────────────────────────────────────────────
      const store = useCradleTabStore.getState()

      // Cmd+W → close active tab
      if (e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey && e.key === 'w') {
        e.preventDefault()
        if (store.activeTabId) {
          store.closeTab(store.activeTabId)
        }
        return
      }

      // Cmd+T → new tab
      if (e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey && e.key === 't') {
        e.preventDefault()
        store.openTab('new-chat')
        return
      }

      // Cmd+1 through Cmd+9 → switch to tab by index
      if (e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey) {
        const digit = Number.parseInt(e.key, 10)
        if (digit >= 1 && digit <= 9) {
          const targetIndex = digit - 1
          const tab = store.tabs[targetIndex]
          if (tab) {
            e.preventDefault()
            store.setActiveTab(tab.id)
          }
          return
        }
      }

      // Ctrl+Tab / Ctrl+Shift+Tab → cycle tabs
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Tab') {
        e.preventDefault()
        const { tabs, activeTabId } = store
        if (tabs.length <= 1) {
          return
        }
        const currentIndex = tabs.findIndex(t => t.id === activeTabId)
        const nextIndex = e.shiftKey
          ? (currentIndex - 1 + tabs.length) % tabs.length
          : (currentIndex + 1) % tabs.length
        store.setActiveTab(tabs[nextIndex].id)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleBottomPanel, toggleAside])

  // PTY notifications: OSC 9, exit, OSC 133;D
  useEffect(() => {
    const unsubNotify = subscribe('pty:notification', ({ sessionId, message }) => {
      if (!isSessionActive(sessionId)) {
        markUnread(sessionId)
      }
      if ('Notification' in window && Notification.permission === 'granted') {
        void new Notification('Cradle', { body: message || '通知' })
      }
    })

    const unsubExit = subscribe('pty:exit', ({ sessionId }) => {
      if (!isSessionActive(sessionId)) {
        markUnread(sessionId)
      }
    })

    const unsubCommandFinish = subscribe('pty:command-finish', ({ sessionId }) => {
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

  // Chat terminal activity events: mark unread when a turn finishes in an inactive session
  useGlobalChatSessionActivityEvent((data) => {
    if (!isSessionActive(data.chatSessionId)) {
      markUnread(data.chatSessionId)
    }
  })
}
