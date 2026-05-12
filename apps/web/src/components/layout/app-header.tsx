// Input: Button, useLayoutStore, lucide icons, @cradle/tabs TabBar, cradleRegistry, Tooltip
// Output: AppHeader — slim header with capsule tabs and panel toggles
// Position: Top chrome of AppLayout's center column; doubles as a macOS window-drag region

import type { TabInstance } from '@cradle/tabs'
import { TabBar } from '@cradle/tabs'
import { PanelBottomIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, PanelRightIcon, PlusIcon, XIcon } from 'lucide-react'
import { useCallback } from 'react'

import { Button } from '~/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'
import { useLayoutStore } from '~/store/layout'
import { cradleRegistry, useCradleTabStore } from '~/tabs/registry'

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

  const renderTabIcon = useCallback((tab: TabInstance) => {
    const def = cradleRegistry[tab.type as keyof typeof cradleRegistry]
    if (!def?.icon) {
      return null
    }
    const Icon = def.icon
    return <Icon className="size-3 text-muted-foreground/60" />
  }, [])

  const renderTooltip = useCallback((tab: TabInstance, children: React.ReactElement) => (
    <TooltipProvider key={tab.id} delay={400}>
      <Tooltip>
        <TooltipTrigger render={children} />
        <TooltipContent side="bottom" sideOffset={4}>
          {tab.label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ), [])

  const handleTabTearOff = useCallback((_tab: TabInstance, _screenX: number, _screenY: number) => {
    // Tab tear-off is not supported in web mode
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
          renderCloseIcon={() => <XIcon className="size-2.5" />}
          renderNewTabIcon={() => <PlusIcon className="size-3" />}
          renderTabIcon={renderTabIcon}
          renderTooltip={renderTooltip}
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
