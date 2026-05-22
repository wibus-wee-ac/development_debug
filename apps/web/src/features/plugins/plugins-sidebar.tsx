import { Link } from '@cradle/tabs-next'
import { PuzzleIcon } from 'lucide-react'
import { useEffect } from 'react'

import { cn } from '~/lib/cn'
import { markCradlePerformance, measureCradlePerformance } from '~/lib/perf-monitor'
import { usePluginStore } from '~/lib/plugin-store'
import { preloadTabRoute } from '~/tabs/route-preload'
import { useCradleTabStore } from '~/tabs/registry'

let firstPluginsSidebarRendered = false

type PluginPanelTab = {
  type: 'plugin-panel'
  params?: {
    panelId?: string
  }
}

export function PluginsSidebar({ collapsed }: { collapsed?: boolean }) {
  const panels = usePluginStore(s => s.panels)
  const activeTab = useCradleTabStore((s) => {
    const tab = s.tabs.find(t => t.id === s.activeTabId)
    return tab
  })
  const ready = panels.length > 0

  useEffect(() => {
    if (!ready || firstPluginsSidebarRendered) {
      return
    }

    firstPluginsSidebarRendered = true
    markCradlePerformance('cradle:first-plugins-sidebar-rendered')
    measureCradlePerformance(
      'cradle:plugins-sidebar-first-render',
      'cradle:plugins-sidebar-render-requested',
      'cradle:first-plugins-sidebar-rendered',
    )
  }, [ready])

  if (!ready) {
    return null
  }

  const activePluginPanelId = activeTab?.type === 'plugin-panel'
    ? (activeTab as PluginPanelTab).params?.panelId
    : undefined

  return (
    <div
      className="flex flex-col px-2 pb-2"
      data-testid="plugins-sidebar"
      data-plugins-sidebar-ready={ready ? 'true' : 'false'}
    >
      <div
        className={cn(
          'px-2 py-1.5 text-[11px] font-medium text-muted-foreground select-none transition-opacity duration-[120ms]',
          collapsed ? 'opacity-0' : 'opacity-100',
        )}
      >
        Extensions
      </div>
      {panels.map(panel => (
        <Link
          key={panel.id}
          to="plugin-panel"
          params={{ panelId: panel.id }}
          onFocus={() => preloadTabRoute('plugin-panel')}
          onMouseEnter={() => preloadTabRoute('plugin-panel')}
          className={cn(
            'flex h-7 items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-sm',
            'hover:bg-fill cursor-pointer',
            activePluginPanelId === panel.id && 'bg-fill text-foreground',
            activePluginPanelId !== panel.id && 'text-muted-foreground',
          )}
        >
          <PuzzleIcon className="size-3.5 shrink-0" />
          <span
            className={cn(
              'min-w-0 flex-1 truncate',
              collapsed ? 'opacity-0' : 'opacity-100',
            )}
          >
            {panel.title}
          </span>
        </Link>
      ))}
    </div>
  )
}
