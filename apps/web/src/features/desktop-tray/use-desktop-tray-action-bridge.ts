import { useCallback, useEffect } from 'react'

import { useSettingsOverlayStore } from '~/features/settings/settings-overlay-store'
import { usePluginStore } from '~/lib/plugin-store'
import { useCradleTabStore } from '~/tabs/registry'

import type { TrayActionId, TrayActionRequest } from './types'

interface DesktopTrayActionBridgeOptions {
  onOpenGlobalSearch: () => void
}

const ACTION_IDS = new Set<TrayActionId>([
  'open-app',
  'open-chat',
  'new-chat',
  'global-search',
  'open-resident',
  'open-running',
  'open-approvals',
  'open-awaits',
  'open-automation',
  'open-workspaces',
  'open-agents',
  'open-providers',
  'open-chronicle',
  'open-usage',
  'open-plugins',
  'open-desktop-settings',
  'quit',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readActionRequest(value: unknown): TrayActionRequest | null {
  if (!isRecord(value) || typeof value.actionId !== 'string' || !ACTION_IDS.has(value.actionId as TrayActionId)) {
    return null
  }
  return {
    actionId: value.actionId as TrayActionId,
    payload: value.payload,
  }
}

function readSessionId(payload: unknown): string | null {
  if (!isRecord(payload) || typeof payload.sessionId !== 'string' || payload.sessionId.length === 0) {
    return null
  }
  return payload.sessionId
}

function openHome(): void {
  useCradleTabStore.getState().openTab('home', {})
}

function openChatFromPayload(payload: unknown): boolean {
  const sessionId = readSessionId(payload)
  if (!sessionId) {
    return false
  }
  useCradleTabStore.getState().openTab('chat', { sessionId })
  return true
}

function openSettingsSection(section: string): void {
  const tabStore = useCradleTabStore.getState()
  const activeTabId = tabStore.activeTabId && tabStore.tabs.some(tab => tab.id === tabStore.activeTabId)
    ? tabStore.activeTabId
    : tabStore.openTab('home', {}, { pinned: true })
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
  useCradleTabStore.getState().openTab('plugin-panel', { panelId: firstPanel.id })
  return true
}

export function useDesktopTrayActionBridge({ onOpenGlobalSearch }: DesktopTrayActionBridgeOptions): void {
  const handleRequest = useCallback((rawRequest: unknown) => {
    const request = readActionRequest(rawRequest)
    if (!request) {
      return
    }

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
      case 'open-approvals':
        useCradleTabStore.getState().openTab('approvals', {})
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
        return
      case 'open-app':
      case 'quit':
        return
    }
  }, [onOpenGlobalSearch])

  useEffect(() => {
    const unsubscribe = window.cradle?.desktopTray?.onActionRequested(handleRequest)

    void window.cradle?.desktopTray?.consumePendingActionRequests?.().then((requests) => {
      if (!Array.isArray(requests)) {
        return
      }
      for (const request of requests) {
        handleRequest(request)
      }
    })
    return unsubscribe ?? undefined
  }, [handleRequest])
}
