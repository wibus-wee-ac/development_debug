import { useEffect, useState } from 'react'

import { cn } from '~/lib/cn'

import { HealthPanel } from './health/health-panel'
import { MemoryPanel } from './memory/memory-panel'
import { ObservabilityEventDetail } from './observability/observability-event-detail'
import { ObservabilityEventsTable } from './observability/observability-events-table'
import { useObservabilityDevtoolStore } from './observability/use-observability-events'
import { PluginsPanel } from './plugins/plugins-panel'
import { TabsPanel } from './tabs/tabs-panel'

type DevtoolTab = 'observability' | 'health' | 'memory' | 'tabs' | 'plugins'

export function DevtoolPage() {
  const loadObservability = useObservabilityDevtoolStore(s => s.load)
  const [tab, setTab] = useState<DevtoolTab>('observability')

  useEffect(() => {
    void loadObservability()
  }, [loadObservability])

  const tabs: { id: DevtoolTab, label: string }[] = [
    { id: 'observability', label: 'Observability' },
    { id: 'health', label: 'Server Health' },
    { id: 'memory', label: 'Memory' },
    { id: 'tabs', label: 'Tabs' },
    { id: 'plugins', label: 'Plugins' },
  ]

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-background px-3 py-2 font-mono text-[10px] text-muted-foreground">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'rounded border px-2 py-1',
              tab === t.id
                ? 'border-border bg-muted text-foreground'
                : 'border-transparent hover:border-border hover:bg-muted/40',
            )}
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto">/devtool</div>
      </div>

      {tab === 'observability' && (
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-3 overflow-hidden border-r border-border">
            <ObservabilityEventsTable />
          </div>
          <div className="flex-2 overflow-hidden">
            <ObservabilityEventDetail />
          </div>
        </div>
      )}

      {tab === 'health' && (
        <div className="flex-1 overflow-hidden">
          <HealthPanel />
        </div>
      )}

      {tab === 'memory' && (
        <div className="flex-1 overflow-hidden">
          <MemoryPanel />
        </div>
      )}

      {tab === 'tabs' && (
        <div className="flex-1 overflow-hidden">
          <TabsPanel />
        </div>
      )}

      {tab === 'plugins' && (
        <div className="flex-1 overflow-hidden">
          <PluginsPanel />
        </div>
      )}
    </div>
  )
}
