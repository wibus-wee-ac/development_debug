// Input: Button, useLayoutStore, lucide icons, @cradle/tabs TabBar, cradleRegistry, Tooltip
// Output: AppHeader — slim header with capsule tabs and panel toggles
// Position: Top chrome of AppLayout's center column; doubles as a macOS window-drag region

import type { TabInstance } from '@cradle/tabs'
import { TabBar } from '@cradle/tabs'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/cn'
import { ipc } from '@renderer/lib/ipc'
import { useLayoutStore } from '@renderer/store/layout'
import { cradleRegistry, useCradleTabStore } from '@renderer/tabs/registry'
import { PanelBottomIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, PanelRightIcon, PlusIcon, XIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback } from 'react'

interface AppHeaderProps {
  title?: ReactNode
  workspace?: ReactNode
  hasAside?: boolean
  hasPanel?: boolean
  /** Optional third breadcrumb segment rendered after workspace/title (e.g. git branch control) */
  gitBranch?: ReactNode
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

  const handleTabTearOff = useCallback((tab: TabInstance, screenX: number, screenY: number) => {
    if (tab.type === 'chat' && tab.params.sessionId) {
      ipc?.window.tearOffSession(tab.params.sessionId, screenX, screenY)
      useCradleTabStore.getState().closeTab(tab.id)
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
      <div className="flex-1 min-w-0 ml-0.5 mr-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <TabBar
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
          >
            <PanelRightIcon />
          </Button>
        )}
      </div>
    </div>
  )
}
