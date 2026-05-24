import { useEffect } from 'react'

import { onAnyChatRunEvent } from '~/features/chat/sse-chat-transport'
import { useSettingsOverlayStore } from '~/features/settings/settings-overlay-store'
import {
  BROWSER_PANEL_WEBVIEW_TAB_SHORTCUT_CHANNEL,
  handleBrowserPanelTabShortcut,
  handleBrowserPanelTabShortcutPayload,
} from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'
import { useSessionActivityStore } from '~/store/session-activity'
import { useCradleTabStore } from '~/tabs/registry'

function deriveVisibleChatSessionId(args: {
  activeTabId: string | null
  settingsTabId: string | null
  tabs: Array<{ id: string, type: string, params?: Record<string, unknown> }>
}) {
  const { activeTabId, settingsTabId, tabs } = args
  if (!activeTabId || settingsTabId === activeTabId) {
    return null
  }

  const activeTab = tabs.find(tab => tab.id === activeTabId)
  if (activeTab?.type !== 'chat') {
    return null
  }

  const sessionId = activeTab.params?.sessionId
  return typeof sessionId === 'string' ? sessionId : null
}

export function useGlobalEventListeners() {
  const toggleBottomPanel = useLayoutStore(s => s.toggleBottomPanel)
  const toggleAside = useLayoutStore(s => s.toggleAside)
  const activeTabId = useCradleTabStore(s => s.activeTabId)
  const tabs = useCradleTabStore(s => s.tabs)
  const settingsTabId = useSettingsOverlayStore(s => s.settingsTabId)

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
      if (handleBrowserPanelTabShortcut(e, { panelOpen: useLayoutStore.getState().browserPanelOpen })) {
        return
      }

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
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [toggleBottomPanel, toggleAside])

  useEffect(() => {
    return window.cradle?.ipc.on(BROWSER_PANEL_WEBVIEW_TAB_SHORTCUT_CHANNEL, (payload) => {
      handleBrowserPanelTabShortcutPayload(payload, {
        panelOpen: useLayoutStore.getState().browserPanelOpen,
      })
    }) ?? (() => {})
  }, [])

  useEffect(() => {
    const visibleSessionId = deriveVisibleChatSessionId({
      activeTabId,
      settingsTabId,
      tabs,
    })
    useSessionActivityStore.getState().setVisibleSession(visibleSessionId)
  }, [activeTabId, settingsTabId, tabs])

  useEffect(() => {
    return onAnyChatRunEvent(({ chatSessionId }) => {
      useSessionActivityStore.getState().recordActivity(chatSessionId)
    })
  }, [])
}
