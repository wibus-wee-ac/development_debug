import { useCallback, useEffect } from 'react'

import { usePluginStore } from '~/lib/plugin-store'
import {
  openAutomation,
  openAwaits,
  openChatSession,
  openHome,
  openNewChat,
  openPluginPanel,
  openSettingsSection,
  openUsage,
} from '~/navigation/navigation-commands'
import { useSettingsOverlayStore } from '~/store/settings-overlay'

import type { TrayActionRequest } from './types'

interface DesktopTrayActionBridgeOptions {
  onOpenGlobalSearch: () => void
}

function openChatFromPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') {
    return false
  }
  const { sessionId } = payload as { sessionId?: unknown }
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return false
  }
  openChatSession(sessionId)
  return true
}

function openSettingsRouteSection(section: string): void {
  const settingsStore = useSettingsOverlayStore.getState()
  settingsStore.setSettingsSection(section)
  openSettingsSection(section)
}

function openFirstPluginPanel(): boolean {
  const firstPanel = usePluginStore.getState().panels[0]
  if (!firstPanel) {
    return false
  }
  openPluginPanel({
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
        openNewChat()
        return
      case 'global-search':
        onOpenGlobalSearch()
        return
      case 'open-awaits':
        openAwaits()
        return
      case 'open-automation':
        openAutomation()
        return
      case 'open-workspaces':
        openHome()
        return
      case 'open-agents':
        openSettingsRouteSection('agents')
        return
      case 'open-providers':
        openSettingsRouteSection('providers')
        return
      case 'open-chronicle':
        openSettingsRouteSection('chronicle')
        return
      case 'open-usage':
        openUsage()
        return
      case 'open-plugins':
        if (!openFirstPluginPanel()) {
          openSettingsRouteSection('skills')
        }
        return
      case 'open-desktop-settings':
        openSettingsRouteSection('desktop')
        return

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
