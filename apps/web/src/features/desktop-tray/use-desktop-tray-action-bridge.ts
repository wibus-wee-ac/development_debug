import { useCallback, useEffect } from 'react'

import { usePluginStore } from '~/lib/plugin-store'
import { useSettingsOverlayStore } from '~/store/settings-overlay'
import { useCradleTabStore } from '~/tabs/registry'

import type { TrayActionRequest } from './types'

interface DesktopTrayActionBridgeOptions {
  onOpenGlobalSearch: () => void
}

function openHome(): void {
  useCradleTabStore.getState().openTab('home', {})
}

function openChatFromPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') {
    return false
  }
  const { sessionId } = payload as { sessionId?: unknown }
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return false
  }
  useCradleTabStore.getState().openTab('chat', { sessionId })
  return true
}

function openSettingsSection(section: string): void {
  const tabStore = useCradleTabStore.getState()
  const activeTabId = tabStore.activeTabId && tabStore.tabs.some(tab => tab.id === tabStore.activeTabId)
    ? tabStore.activeTabId
    : (() => {
        return tabStore.openTab('home', {}, { pinned: true })
      })()
  const settingsStore = useSettingsOverlayStore.getState()
  tabStore.setActiveTab(activeTabId)
  settingsStore.setSettingsSection(section)
  settingsStore.openSettings(activeTabId)
}

function openFirstPluginPanel(): boolean {
  const firstPanel = usePluginStore.getState().panels[0]
  if (!firstPanel) {
    return false
  }
  useCradleTabStore.getState().openTab('plugin-panel', {
    routeSegment: firstPanel.routeSegment,
    localId: firstPanel.localId,
  })
  return true
}

export function useDesktopTrayActionBridge({ onOpenGlobalSearch }: DesktopTrayActionBridgeOptions): void {
  const handleRequest = useCallback((rawRequest: unknown) => {
    const request = rawRequest as TrayActionRequest

    switch (request.actionId) {
      case 'open-chat':
        openChatFromPayload(request.payload)
        return
      case 'new-chat':
        useCradleTabStore.getState().openTab('new-chat', {})
        return
      case 'global-search':
        onOpenGlobalSearch()
        return
      case 'open-resident':
      case 'open-running':
        if (!openChatFromPayload(request.payload)) {
          openHome()
        }
        return
      case 'open-awaits':
        useCradleTabStore.getState().openTab('awaits', {})
        return
      case 'open-automation':
        useCradleTabStore.getState().openTab('automation', {})
        return
      case 'open-workspaces':
        openHome()
        return
      case 'open-agents':
        openSettingsSection('agents')
        return
      case 'open-providers':
        openSettingsSection('providers')
        return
      case 'open-chronicle':
        openSettingsSection('chronicle')
        return
      case 'open-usage':
        useCradleTabStore.getState().openTab('usage', {})
        return
      case 'open-plugins':
        if (!openFirstPluginPanel()) {
          openSettingsSection('skills')
        }
        return
      case 'open-desktop-settings':
        openSettingsSection('desktop')

      case 'open-app':
      case 'quit':
    }
  }, [onOpenGlobalSearch])

  useEffect(() => {
    const unsubscribe = window.cradle?.desktopTray?.onActionRequested(handleRequest)

    void window.cradle?.desktopTray?.consumePendingActionRequests?.().then((requests) => {
      for (const request of requests as TrayActionRequest[]) {
        handleRequest(request)
      }
    })
    return unsubscribe ?? undefined
  }, [handleRequest])
}
