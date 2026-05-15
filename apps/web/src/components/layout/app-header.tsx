// Input: Button, useLayoutStore, lucide icons, @cradle/tabs-next TabBar, cradleRegistry, Tooltip
// Output: AppHeader — slim header with capsule tabs and panel toggles
// Position: Top chrome of AppLayout's center column; doubles as a macOS window-drag region

import type { TabInstance } from '@cradle/tabs-next'
import { TabBar } from '@cradle/tabs-next'
import { PanelBottomIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, PanelRightIcon } from 'lucide-react'
import { useCallback } from 'react'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'
import { useLayoutStore } from '~/store/layout'
import { useCradleTabStore } from '~/tabs/registry'

interface AppHeaderProps {
  hasAside?: boolean
  hasPanel?: boolean
}

export function AppHeader({ hasAside = false, hasPanel = false }: AppHeaderProps) {
  'use no memo'
  const { bottomPanelOpen, asideOpen, toggleBottomPanel, toggleAside, sidebarCollapsed, toggleSidebar, isSettings } = useLayoutStore()
  const activeTabType = useCradleTabStore(s => s.tabs.find(t => t.id === s.activeTabId)?.type)
  const isKanban = activeTabType === 'kanban-board'
  const isDrillIn = isSettings || isKanban

  const handleTabActivated = useCallback((_tab: { id: string }) => {
    // Tab store already handles activation via TabBar's internal onClick
  }, [])

  const handleNewTab = useCallback(() => {
    useCradleTabStore.getState().openTab('new-chat')
  }, [])

  const handleTabTearOff = useCallback((tab: TabInstance, screenX: number, screenY: number) => {
    // In Electron, tear off the tab into a new window
    if (window.cradle?.env?.isElectron && tab.type === 'chat') {
      const sessionId = (tab.params as { sessionId?: string })?.sessionId
      if (sessionId) {
        window.cradle.ipc.invoke('window.tearOffSession', sessionId, screenX, screenY)
      }
    }
  }, [])

  return (
    <div
      className="relative flex h-10 shrink-0 items-center bg-sidebar pe-1 pl-1 mt-1 mb-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left: sidebar toggle (hidden in drill-in modes where sidebar is forced open) */}
      {!isDrillIn && (
        <Button
          variant="ghost"
          size="icon-xs"
          className={cn('text-muted-foreground shrink-0', sidebarCollapsed && 'ml-6')}
          onClick={toggleSidebar}
          title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {sidebarCollapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
        </Button>
      )}

      {/* Tab bar */}
      <div className="flex-1 min-w-0 ml-0.5 mr-1 h-full" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <TabBar
          className="h-full"
          onNewTab={handleNewTab}
          onTabActivated={handleTabActivated}
          onTabTearOff={handleTabTearOff}
        />
      </div>

      {/* Right: panel toggles */}
      <div className="ml-auto flex shrink-0 items-center gap-0.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {hasPanel && (
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn('text-muted-foreground', bottomPanelOpen && 'text-foreground')}
            onClick={toggleBottomPanel}
            title="切换底部面板"
            data-testid="app-header-panel-toggle"
          >
            <PanelBottomIcon />
          </Button>
        )}
        {hasAside && (
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn('text-muted-foreground', asideOpen && 'text-foreground')}
            onClick={toggleAside}
            title="切换右侧面板"
            data-testid="app-header-aside-toggle"
          >
            <PanelRightIcon />
          </Button>
        )}
      </div>
    </div>
  )
}
