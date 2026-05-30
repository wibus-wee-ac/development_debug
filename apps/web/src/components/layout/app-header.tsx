import type { TabBarCustomization, TabInstance } from '@cradle/tabs-next'
import { TabBar } from '@cradle/tabs-next'
import { GlobeIcon, PanelBottomIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, PanelRightIcon, PlusIcon, SettingsIcon, XIcon } from 'lucide-react'
import { m } from 'motion/react'
import { useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { ResourcesPopover } from '~/features/devtool/resources/resources-popover'
import { useSettingsOverlayStore } from '~/store/settings-overlay'
import { cn } from '~/lib/cn'
import { isTearoffWindow, nativeIpc, platform, subscribePointerOutsideWindow } from '~/lib/electron'
import { useLayoutStore } from '~/store/layout'
import { cradleRegistry, useCradleTabStore } from '~/tabs/registry'
import { detachTearoffSessionTab } from '~/tabs/tearoff-tabs'

interface AppHeaderProps {
  hasAside?: boolean
  hasBrowserPanel?: boolean
  hasPanel?: boolean
  sessionScoped?: boolean
}

export function AppHeader({ hasAside = false, hasBrowserPanel = false, hasPanel = false, sessionScoped = false }: AppHeaderProps) {
  'use no memo'
  const { t } = useTranslation('chrome')
  const { bottomPanelOpen, asideOpen, toggleBottomPanel, toggleAside, sidebarCollapsed, toggleSidebar, browserPanelOpen, toggleBrowserPanel } = useLayoutStore()
  const settingsTabId = useSettingsOverlayStore(s => s.settingsTabId)
  // Settings is open on a specific tab; we're "in settings" view when that tab is active
  const isSettingsActive = useCradleTabStore(s => settingsTabId !== null && s.activeTabId === settingsTabId)
  const isDrillIn = isSettingsActive
  const sidebarToggleLabel = sidebarCollapsed ? t('header.action.expandSidebar') : t('header.action.collapseSidebar')
  const reserveTrafficLightSpace = isTearoffWindow && platform === 'darwin'

  const handleTabActivated = useCallback(() => {
    // No-op: settings is now per-tab, tab switching is handled by isSettingsVisible in app.tsx
  }, [])

  const handleNewTab = useCallback(() => {
    useCradleTabStore.getState().openTab('new-chat')
  }, [])

  const handleTabTearOff = useCallback((tab: TabInstance, screenX: number, screenY: number) => {
    // In Electron, tear off the tab into a new window
    if (window.cradle?.env?.isElectron && tab.type === 'chat') {
      const sessionId = (tab.params as { sessionId?: string })?.sessionId
      if (sessionId) {
        void window.cradle.ipc.invoke('window.tearOffSession', sessionId, screenX, screenY)
          .then(() => {
            if (!isTearoffWindow) {
              detachTearoffSessionTab(useCradleTabStore, sessionId)
            }
          })
          .catch(() => {})
      }
    }
  }, [])

  const draggingTabRef = useRef<TabInstance | null>(null)
  const pointerUnsubRef = useRef<(() => void) | null>(null)
  const teardownPointerMonitorRef = useRef<(() => void) | null>(null)

  const teardownPointerMonitor = useCallback(() => {
    pointerUnsubRef.current?.()
    pointerUnsubRef.current = null
    teardownPointerMonitorRef.current?.()
    teardownPointerMonitorRef.current = null
    draggingTabRef.current = null
  }, [])

  const handleDragStart = useCallback((tab: TabInstance) => {
    if (!window.cradle?.env?.isElectron || sessionScoped) {
      return
    }
    draggingTabRef.current = tab

    // Subscribe to pointer-outside-window events from main process
    pointerUnsubRef.current = subscribePointerOutsideWindow((screenX, screenY) => {
      const currentTab = draggingTabRef.current
      if (currentTab) {
        handleTabTearOff(currentTab, screenX, screenY)
        teardownPointerMonitor()
      }
    })

    // Tell main process to start monitoring
    nativeIpc?.window.startPointerMonitor().catch(() => {})
    teardownPointerMonitorRef.current = () => {
      nativeIpc?.window.stopPointerMonitor().catch(() => {})
    }
  }, [handleTabTearOff, sessionScoped, teardownPointerMonitor])

  const handleDragEnd = useCallback(() => {
    teardownPointerMonitor()
  }, [teardownPointerMonitor])

  // Overlay the settings tab pill with Settings icon+label regardless of which tab is active
  const tabPresentation = useMemo(() => {
    if (!settingsTabId) {
      return undefined
    }
    return {
      [settingsTabId]: {
        icon: <SettingsIcon className="size-3 shrink-0" />,
        label: t('header.tab.settings'),
      },
    }
  }, [settingsTabId, t])

  const tabBarCustomization = useMemo<TabBarCustomization>(() => ({
    closeIcon: <XIcon className="size-3" />,
    newTabIcon: <PlusIcon className="size-3" />,
    tabIcon: (tab: TabInstance) => {
      const route = cradleRegistry[tab.type as keyof typeof cradleRegistry]
      if (!route?.icon) {
        return null
      }
      const Icon = route.icon as React.ComponentType<{ className?: string }>
      return <Icon className="size-3 shrink-0" />
    },
  }), [])

  return (
    <div
      className="relative flex h-11 shrink-0 items-center bg-sidebar pe-1 pl-1 mt-1 mb-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left: sidebar toggle (hidden in drill-in modes where sidebar is forced open) */}
      {!isDrillIn && !isTearoffWindow && (
        <m.div
          initial={false}
          animate={{ marginLeft: sidebarCollapsed ? 24 : 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden flex items-center"
        >
          <Button
            variant="ghost"
            size="icon-xs"
            // , sidebarCollapsed && 'ml-6'
            className={cn('text-muted-foreground shrink-0')}
            onClick={toggleSidebar}
            aria-label={sidebarToggleLabel}
            title={sidebarToggleLabel}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {sidebarCollapsed ? <PanelLeftOpenIcon aria-hidden="true" /> : <PanelLeftCloseIcon aria-hidden="true" />}
          </Button>
        </m.div>
      )}
      {reserveTrafficLightSpace && (
        <div
          aria-hidden="true"
          className="h-full w-20 shrink-0"
        />
      )}

      {/* Tab bar */}
      <div className="flex-1 min-w-0 ml-0.5 mr-1 h-full" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <TabBar
          className="h-full"
          onNewTab={sessionScoped ? undefined : handleNewTab}
          onTabActivated={handleTabActivated}
          onTabTearOff={sessionScoped ? undefined : handleTabTearOff}
          onDragStart={sessionScoped ? undefined : handleDragStart}
          onDragEnd={sessionScoped ? undefined : handleDragEnd}
          customization={tabBarCustomization}
          tabPresentation={tabPresentation}
        />
      </div>

      {/* Right: panel toggles */}
      <div className="ml-auto flex shrink-0 items-center gap-0.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <ResourcesPopover />
        {!isSettingsActive && hasBrowserPanel && (
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn('text-muted-foreground', browserPanelOpen && 'text-foreground')}
            onClick={toggleBrowserPanel}
            aria-label={t('header.action.toggleBrowserPanel')}
            aria-pressed={browserPanelOpen}
            title={t('header.action.toggleBrowserPanel')}
            data-testid="app-header-browser-toggle"
          >
            <GlobeIcon aria-hidden="true" />
          </Button>
        )}
        {!isSettingsActive && hasPanel && (
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn('text-muted-foreground', bottomPanelOpen && 'text-foreground')}
            onClick={toggleBottomPanel}
            aria-label={t('header.action.toggleBottomPanel')}
            aria-pressed={bottomPanelOpen}
            title={t('header.action.toggleBottomPanel')}
            data-testid="app-header-panel-toggle"
          >
            <PanelBottomIcon aria-hidden="true" />
          </Button>
        )}
        {!isSettingsActive && hasAside && (
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn('text-muted-foreground', asideOpen && 'text-foreground')}
            onClick={toggleAside}
            aria-label={t('header.action.toggleRightPanel')}
            aria-pressed={asideOpen}
            title={t('header.action.toggleRightPanel')}
            data-testid="app-header-aside-toggle"
          >
            <PanelRightIcon aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  )
}
