import type { DebugMetrics, DebugSnapshot } from '@cradle/tabs-next'
import { useEffect } from 'react'

import { startTabsDebugSync, useTabsDebugStore } from './use-tabs-debug-store'

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function formatTimestamp(value: number | null): string {
  if (!value) {
    return '-'
  }
  return new Date(value).toLocaleTimeString('en-US', { hour12: false })
}

function MetricTable({ metrics }: { metrics: DebugMetrics }) {
  const rows: Array<[string, string]> = [
    ['Open', formatNumber(metrics.openCount)],
    ['Create', formatNumber(metrics.createCount)],
    ['Activate', formatNumber(metrics.activateCount)],
    ['Navigate', formatNumber(metrics.navigateCount)],
    ['Close', formatNumber(metrics.closeCount)],
    ['Renderer Commits', formatNumber(metrics.rendererCommitCount)],
    ['Recent Duration', `${formatNumber(metrics.rendererDurationRecent)} ms`],
    ['Total Duration', `${formatNumber(metrics.rendererDurationTotal)} ms`],
  ]

  return (
    <table className="w-full text-left">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label} className="border-b border-border">
            <td className="py-1.5 pr-6 text-muted-foreground">{label}</td>
            <td className="py-1.5 text-foreground">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function SnapshotSummary({
  connected,
  lastMessageAt,
  snapshot,
}: {
  connected: boolean
  lastMessageAt: number | null
  snapshot: DebugSnapshot
}) {
  const rows: Array<[string, string]> = [
    ['Connection', connected ? 'live' : 'cached'],
    ['Updated', formatTimestamp(lastMessageAt)],
    ['Active Tab', snapshot.activeTabId ?? '-'],
    ['Tabs', String(snapshot.tabCount)],
    ['Contexts', String(snapshot.contextCount)],
    ['Activities', String(snapshot.activityTabIds.length)],
  ]

  return (
    <table className="w-full text-left">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label} className="border-b border-border">
            <td className="py-1.5 pr-6 text-muted-foreground">{label}</td>
            <td className="py-1.5 text-foreground">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function TabsTable({ snapshot }: { snapshot: DebugSnapshot }) {
  const activityIds = new Set(snapshot.activityTabIds)

  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[760px] text-left">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-1.5 pr-3 font-normal">ID</th>
            <th className="py-1.5 pr-3 font-normal">Type</th>
            <th className="py-1.5 pr-3 font-normal">Label</th>
            <th className="py-1.5 pr-3 font-normal">Activity</th>
            <th className="py-1.5 pr-3 font-normal">Active</th>
            <th className="py-1.5 font-normal">Pinned</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.tabs.map(tab => (
            <tr key={tab.id} className="border-b border-border">
              <td className="py-1.5 pr-3 text-muted-foreground">{tab.id}</td>
              <td className="py-1.5 pr-3">{tab.type}</td>
              <td className="max-w-[320px] truncate py-1.5 pr-3">{tab.label}</td>
              <td className={activityIds.has(tab.id) ? 'py-1.5 pr-3 text-foreground' : 'py-1.5 pr-3 text-muted-foreground/60'}>
                {activityIds.has(tab.id) ? 'yes' : 'no'}
              </td>
              <td className={snapshot.activeTabId === tab.id ? 'py-1.5 pr-3 text-foreground' : 'py-1.5 pr-3 text-muted-foreground/60'}>
                {snapshot.activeTabId === tab.id ? 'yes' : 'no'}
              </td>
              <td className="py-1.5 text-muted-foreground">{tab.pinned ? 'yes' : 'no'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ContextsTable({ snapshot }: { snapshot: DebugSnapshot }) {
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[560px] text-left">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-1.5 pr-3 font-normal">ID</th>
            <th className="py-1.5 pr-3 font-normal">History</th>
            <th className="py-1.5 pr-3 font-normal">Index</th>
            <th className="py-1.5 pr-3 font-normal">Keep Alive</th>
            <th className="py-1.5 font-normal">View State</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.contexts.map(context => (
            <tr key={context.id} className="border-b border-border">
              <td className="py-1.5 pr-3 text-muted-foreground">{context.id}</td>
              <td className="py-1.5 pr-3">{context.historyLen}</td>
              <td className="py-1.5 pr-3">{context.index}</td>
              <td className="py-1.5 pr-3">{context.keepAlive}</td>
              <td className="py-1.5 text-muted-foreground">
                {context.viewStateKeys.length > 0 ? context.viewStateKeys.join(', ') : '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function TabsPanel() {
  const connected = useTabsDebugStore(s => s.connected)
  const debugState = useTabsDebugStore(s => s.debugState)
  const lastMessageAt = useTabsDebugStore(s => s.lastMessageAt)
  const refresh = useTabsDebugStore(s => s.refresh)
  const resetMetrics = useTabsDebugStore(s => s.resetMetrics)

  useEffect(() => startTabsDebugSync(), [])

  if (!debugState) {
    return (
      <div className="flex h-full items-center justify-center p-4 font-mono text-xs text-muted-foreground/50">
        No tabs debug stream available
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto p-4 font-mono text-[11px]">
      <div className="mb-4 flex items-center gap-2">
        <div className="text-xs text-muted-foreground">Tabs Runtime</div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            className="rounded border border-border px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={resetMetrics}
            className="rounded border border-border px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Reset Metrics
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section>
          <div className="mb-2 text-xs text-muted-foreground">Snapshot</div>
          <SnapshotSummary connected={connected} lastMessageAt={lastMessageAt} snapshot={debugState.snapshot} />
        </section>
        <section>
          <div className="mb-2 text-xs text-muted-foreground">Metrics</div>
          <MetricTable metrics={debugState.metrics} />
        </section>
      </div>

      <section className="mt-5">
        <div className="mb-2 text-xs text-muted-foreground">Tabs</div>
        <TabsTable snapshot={debugState.snapshot} />
      </section>

      <section className="mt-5">
        <div className="mb-2 text-xs text-muted-foreground">Contexts</div>
        <ContextsTable snapshot={debugState.snapshot} />
      </section>
    </div>
  )
}
