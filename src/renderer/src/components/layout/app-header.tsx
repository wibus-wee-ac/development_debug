// Input: Button, useLayoutStore, lucide icons
// Output: AppHeader — slim breadcrumb header with bottom-panel / aside toggles on the right
// Position: Top chrome of AppLayout's center column; doubles as a macOS window-drag region

import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { useLayoutStore } from '@renderer/store/layout'
import { PanelBottomIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, PanelRightIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface AppHeaderProps {
  title?: ReactNode
  workspace?: ReactNode
  hasAside?: boolean
  hasPanel?: boolean
  /** When true, add left padding to clear macOS Traffic Lights in a hiddenInset tear-off window */
  trafficLight?: boolean
  /** Optional third breadcrumb segment rendered after workspace/title (e.g. git branch control) */
  gitBranch?: ReactNode
}

export function AppHeader({ title, workspace, hasAside = true, hasPanel = true, trafficLight = false, gitBranch }: AppHeaderProps) {
  const { bottomPanelOpen, asideOpen, toggleBottomPanel, toggleAside, sidebarCollapsed, toggleSidebar } = useLayoutStore()

  const hasBreadcrumb = (workspace !== undefined && workspace !== null && workspace !== '')
    || (title !== undefined && title !== null && title !== '')
  const hasWorkspace = workspace !== undefined && workspace !== null && workspace !== ''
  const hasTitle = title !== undefined && title !== null && title !== ''

  return (
    <div
      className={cn('relative flex h-9.5 shrink-0 items-center bg-sidebar pe-1', trafficLight ? 'pl-18.5' : 'pl-1')}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left: sidebar toggle */}
      <Button
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground shrink-0"
        onClick={toggleSidebar}
        title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {sidebarCollapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
      </Button>

      {/* Center: breadcrumb — absolutely centered */}
      {hasBreadcrumb && (
        <nav
          aria-label="Breadcrumb"
          className="pointer-events-none absolute inset-x-0 flex items-center justify-center text-xs"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div className="pointer-events-auto flex min-w-0 max-w-xs items-center">
            {hasWorkspace && (
              <span className={cn('truncate', hasTitle ? 'text-muted-foreground' : 'text-foreground font-medium')}>
                {workspace}
              </span>
            )}
            {hasWorkspace && hasTitle && (
              <span aria-hidden="true" className="mx-2 shrink-0 select-none text-muted-foreground/40">/</span>
            )}
            {hasTitle && (
              <span className="truncate font-medium text-foreground">{title}</span>
            )}
            {gitBranch && (hasTitle || hasWorkspace) && (
              <span aria-hidden="true" className="mx-2 shrink-0 select-none text-muted-foreground/40">/</span>
            )}
            {gitBranch}
          </div>
        </nav>
      )}

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
