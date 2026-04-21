// Input: WorkspaceSidebar, layout store, useShortcut hook, TanStack Router
// Output: AppSidebar component — workspace sidebar with settings navigation button
// Position: Internal child of AppLayout; rendered inside each route that uses AppLayout

import { WorkspaceSidebar } from '@renderer/features/workspace'
import { useShortcut } from '@renderer/hooks/use-shortcut'
import { useLayoutStore } from '@renderer/store/layout'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { SettingsIcon } from 'lucide-react'
import { useCallback } from 'react'

export function AppSidebar() {
  const navigate = useNavigate()
  const routerState = useRouterState()
  const isSettings = routerState.location.pathname.startsWith('/settings')
  const { sidebarWidth } = useLayoutStore()

  const goToSettings = useCallback(() => {
    // @ts-expect-error settings route not yet in routeTree.gen.ts registry; remove after first vite dev run
    void navigate({ to: '/settings' })
  }, [navigate])

  const backToMain = useCallback(() => {
    void navigate({ to: '/' })
  }, [navigate])

  const toggleSettings = useCallback(() => {
    if (isSettings) {
      backToMain()
    }
    else {
      goToSettings()
    }
  }, [isSettings, backToMain, goToSettings])

  useShortcut('toggle-settings', { meta: true, key: ',' }, toggleSettings)
  useShortcut('exit-settings', { key: 'Escape' }, backToMain, !isSettings)

  return (
    <aside
      className="flex flex-col shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground overflow-hidden"
      style={{ width: sidebarWidth }}
    >
      <div className="h-11 shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      <div
        className="relative flex flex-col flex-1 overflow-hidden"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="flex flex-1 flex-col overflow-hidden">
          <WorkspaceSidebar />

          <div className="shrink-0 border-t border-sidebar-border px-3 py-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={goToSettings}
              data-testid="settings-btn"
              className="flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-sidebar-foreground/70 hover:bg-accent/50 hover:text-sidebar-foreground transition-colors"
            >
              <SettingsIcon className="size-4" aria-hidden="true" />
              <span>设置</span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}
