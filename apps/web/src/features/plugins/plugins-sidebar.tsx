// Input: usePluginStore, tab store, Link
// Output: PluginsSidebar — sidebar section listing registered plugin panels
// Position: Inside WorkspaceSidebar, shows installed plugin panels as nav items

import { Link } from '@cradle/tabs-next'
import { PuzzleIcon } from 'lucide-react'

import { cn } from '~/lib/cn'
import { usePluginStore } from '~/lib/plugin-store'
import { useCradleTabStore } from '~/tabs/registry'

export function PluginsSidebar({ collapsed }: { collapsed?: boolean }) {
  const panels = usePluginStore((s) => s.panels)
  const activeTab = useCradleTabStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId)
    return tab
  })

  if (panels.length === 0) return null

  const isPluginTabActive = (panelId: string) =>
    activeTab?.type === 'plugin-panel' && (activeTab as any).params?.panelId === panelId

  return (
    <div
      className="flex flex-col px-2 pb-2"
      style={{ opacity: collapsed ? 0 : 1, transition: 'opacity 120ms ease', pointerEvents: collapsed ? 'none' : undefined }}
    >
      <div className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground select-none">Extensions</div>
      {panels.map((panel) => (
        <Link
          key={panel.id}
          to="plugin-panel"
          params={{ panelId: panel.id }}
          className={cn(
            'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
            'hover:bg-fill cursor-pointer',
            isPluginTabActive(panel.id) && 'bg-fill text-foreground',
            !isPluginTabActive(panel.id) && 'text-muted-foreground',
          )}
        >
          <PuzzleIcon className="size-3.5 shrink-0" />
          {!collapsed && <span className="truncate">{panel.title}</span>}
        </Link>
      ))}
    </div>
  )
}
