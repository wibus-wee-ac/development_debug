// Input: Button, useLayoutStore, lucide icons
// Output: AppHeader — slim breadcrumb header with bottom-panel / aside toggles on the right
// Position: Top chrome of AppLayout's center column; doubles as a macOS window-drag region

import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { useLayoutStore } from '@renderer/store/layout'
import { PanelBottomIcon, PanelRightIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface AppHeaderProps {
  title?: ReactNode
  workspace?: ReactNode
  hasAside?: boolean
  hasPanel?: boolean
  /** When true, add left padding to clear macOS Traffic Lights in a hiddenInset tear-off window */
  trafficLight?: boolean
}

export function AppHeader({ title, workspace, hasAside = true, hasPanel = true, trafficLight = false }: AppHeaderProps) {
  const { bottomPanelOpen, asideOpen, toggleBottomPanel, toggleAside } = useLayoutStore()

  if (title === undefined && workspace === undefined) {
    // Even without breadcrumbs, render the header shell for panel toggle buttons
    return (
      <div
        className={cn('flex h-11 shrink-0 items-center border-b border-border bg-background pe-1', trafficLight ? 'pl-18.5' : 'ps-3')}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex-1" />
        <div
          className="flex items-center gap-0.5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn('text-muted-foreground', bottomPanelOpen && 'text-foreground')}
            onClick={toggleBottomPanel}
            title="切换底部面板"
            style={{ display: hasPanel ? undefined : 'none' }}
          >
            <PanelBottomIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn('text-muted-foreground', asideOpen && 'text-foreground')}
            onClick={toggleAside}
            title="切换右侧面板"
            style={{ display: hasAside ? undefined : 'none' }}
          >
            <PanelRightIcon />
          </Button>
        </div>
      </div>
    )
  }

  const hasWorkspace = workspace !== undefined && workspace !== null && workspace !== ''
  const hasTitle = title !== undefined && title !== null && title !== ''

  return (
    <div
      className={cn('flex h-11 shrink-0 items-center gap-2 border-b border-border bg-background pe-1', trafficLight ? 'pl-18.5' : 'ps-3')}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 flex-1 items-center text-xs"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {hasWorkspace && (
          <span
            className={cn(
              'truncate',
              hasTitle ? 'text-muted-foreground' : 'text-foreground font-medium',
            )}
          >
            {workspace}
          </span>
        )}
        {hasWorkspace && hasTitle && (
          <span
            aria-hidden="true"
            className="mx-2 shrink-0 text-muted-foreground/40 select-none"
          >
            /
          </span>
        )}
        {hasTitle && (
          <span className="truncate font-medium text-foreground">{title}</span>
        )}
      </nav>

      <div
        className="flex shrink-0 items-center gap-0.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <HeaderToggle
          icon={<PanelBottomIcon aria-hidden="true" />}
          label="显示底部面板"
          active={bottomPanelOpen}
          onClick={toggleBottomPanel}
          hidden={!hasPanel}
        />
        <HeaderToggle
          icon={<PanelRightIcon aria-hidden="true" />}
          label="显示右侧面板"
          active={asideOpen}
          onClick={toggleAside}
          hidden={!hasAside}
        />
      </div>
    </div>
  )
}

interface HeaderToggleProps {
  icon: ReactNode
  label: string
  active: boolean
  onClick: () => void
  hidden?: boolean
}

function HeaderToggle({ icon, label, active, onClick, hidden }: HeaderToggleProps) {
  if (hidden) {
    return null
  }
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'transition-colors',
        active
          ? 'bg-accent/40 text-foreground'
          : 'text-muted-foreground/60 hover:text-foreground',
      )}
    >
      {icon}
    </Button>
  )
}
