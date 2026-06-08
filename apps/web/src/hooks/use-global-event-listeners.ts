import type { QueryClient } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { getChatSessionsBySessionIdMessagesQueryKey, getSessionsByIdQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { postSessionsByIdRead } from '~/api-gen/sdk.gen'
import { runtimeUiSlotStatesQueryKey } from '~/features/chat/capabilities/chat-capabilities'
import { runtimeSettingsQueryKey } from '~/features/chat/commands/runtime-settings-command'
import { runtimeSessionStatusQueryKey } from '~/features/chat/runtime/use-runtime-session-status'
import { onAnyChatRunEvent, onChatRunSettled } from '~/features/chat/transport/sse-chat-transport'
import { isSessionsQueryKey, updateSessionReadState } from '~/features/workspace/use-session'
import {
  BROWSER_PANEL_WEBVIEW_TAB_SHORTCUT_CHANNEL,
  handleBrowserPanelTabShortcut,
  handleBrowserPanelTabShortcutPayload,
} from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'
import { useSessionActivityStore } from '~/store/session-activity'
import { useSettingsOverlayStore } from '~/store/settings-overlay'
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

function invalidateChatSessionRuntimeQueries(queryClient: QueryClient, sessionId: string): void {
  void queryClient.invalidateQueries({
    queryKey: getChatSessionsBySessionIdMessagesQueryKey({ path: { sessionId } }),
  })
  void queryClient.invalidateQueries({
    queryKey: getSessionsByIdQueryKey({ path: { id: sessionId } }),
  })
  void queryClient.invalidateQueries({ queryKey: runtimeSessionStatusQueryKey(sessionId) })
  void queryClient.invalidateQueries({ queryKey: ['chat', 'session-queue', sessionId] })
  void queryClient.invalidateQueries({ queryKey: runtimeUiSlotStatesQueryKey(sessionId) })
  void queryClient.invalidateQueries({ queryKey: runtimeSettingsQueryKey(sessionId) })
  void queryClient.invalidateQueries({ predicate: query => isSessionsQueryKey(query.queryKey) })
}

export function useGlobalEventListeners() {
  const queryClient = useQueryClient()
  const toggleBottomPanel = useLayoutStore(s => s.toggleBottomPanel)
  const toggleAside = useLayoutStore(s => s.toggleAside)
  const settingsTabId = useSettingsOverlayStore(s => s.settingsTabId)
  const visibleSessionId = useCradleTabStore(s => deriveVisibleChatSessionId({
    activeTabId: s.activeTabId,
    settingsTabId,
    tabs: s.tabs,
  }))

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
      const layoutState = useLayoutStore.getState()
      if (handleBrowserPanelTabShortcut(e, {
        panelOpen: layoutState.browserPanelOpen,
        ownerId: layoutState.activeBrowserPanelOwnerId,
        onCloseLastTab: ownerId => useLayoutStore.getState().setBrowserPanelOpen(false, ownerId),
      })) {
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
      const layoutState = useLayoutStore.getState()
      handleBrowserPanelTabShortcutPayload(payload, {
        panelOpen: layoutState.browserPanelOpen,
        ownerId: layoutState.activeBrowserPanelOwnerId,
        onCloseLastTab: ownerId => useLayoutStore.getState().setBrowserPanelOpen(false, ownerId),
      })
    }) ?? (() => {})
  }, [])

  useEffect(() => {
    useSessionActivityStore.getState().setVisibleSession(visibleSessionId)
    if (!visibleSessionId) {
      return
    }

    void postSessionsByIdRead({ path: { id: visibleSessionId } })
      .then(({ data }) => {
        if (data) {
          updateSessionReadState(queryClient, data)
        }
      })
      .catch(() => {})
  }, [queryClient, visibleSessionId])

  useEffect(() => {
    return onChatRunSettled(({ chatSessionId }) => {
      invalidateChatSessionRuntimeQueries(queryClient, chatSessionId)
      if (useSessionActivityStore.getState().visibleSessionId === chatSessionId) {
        void postSessionsByIdRead({ path: { id: chatSessionId } })
          .then(({ data }) => {
            if (data) {
              updateSessionReadState(queryClient, data)
            }
          })
          .catch(() => {})
      }
    })
  }, [queryClient])

  useEffect(() => {
    return onAnyChatRunEvent(({ chatSessionId, chunk }) => {
      if (chunk.type !== 'start') {
        return
      }
      invalidateChatSessionRuntimeQueries(queryClient, chatSessionId)
    })
  }, [queryClient])
}
