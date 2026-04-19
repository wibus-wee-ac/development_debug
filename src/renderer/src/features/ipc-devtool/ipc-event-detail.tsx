// Input: superjson for payload decoding, @cradle/ipc payload type, Zustand selection store, cn utility
// Output: IpcEventDetail — selected trace metadata + args/result/error/stack tabs with copy-to-clipboard
// Position: Right pane inside the IPC devtool page

import type { IpcObservedPayload } from '@cradle/ipc'
import { useMemo } from 'react'
import superjson from 'superjson'

import { cn } from '@renderer/lib/utils'

import type { IpcDetailTab, IpcTracePhases } from './use-ipc-events'
import { useIpcDevtoolStore, useIpcTraces } from './use-ipc-events'

const TABS: Array<{ key: IpcDetailTab; label: string }> = [
  { key: 'args', label: 'Args' },
  { key: 'result', label: 'Result' },
  { key: 'error', label: 'Error' },
  { key: 'stack', label: 'Stack' },
]

const PHASE_ORDER: Array<keyof IpcTracePhases> = [
  'renderer:start',
  'main:start',
  'main:finish',
  'renderer:finish',
]

function formatPayload(payload: IpcObservedPayload | null): string {
  if (!payload) return ''
  try {
    const value = superjson.parse(payload.json)
    return JSON.stringify(value, null, 2)
  } catch {
    return payload.json
  }
}

export function IpcEventDetail() {
  const selectedTraceId = useIpcDevtoolStore((s) => s.selectedTraceId)
  const traces = useIpcTraces()
  const trace = useMemo(
    () => traces.find((t) => t.traceId === selectedTraceId) ?? null,
    [traces, selectedTraceId],
  )
  const tab = useIpcDevtoolStore((s) => s.detailTab)
  const setTab = useIpcDevtoolStore((s) => s.setDetailTab)

  if (!trace) {
    return (
      <div className="flex h-full items-center justify-center p-4 font-mono text-xs text-muted-foreground">
        Select a trace to inspect
      </div>
    )
  }

  const payloadText = (() => {
    switch (tab) {
      case 'args':
        return formatPayload(trace.args)
      case 'result':
        return formatPayload(trace.result)
      case 'error':
        return formatPayload(trace.error)
      case 'stack':
        return trace.callerStack.join('\n')
    }
  })()

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background font-mono">
      <div className="shrink-0 border-b border-border px-3 py-2 text-[10px]">
        <div className="flex items-baseline justify-between gap-2">
          <div className="truncate text-[11px] font-medium text-foreground">{trace.channel}</div>
          <div className="shrink-0 tabular-nums text-muted-foreground">
            {trace.durationMs !== null ? `${trace.durationMs}ms` : 'pending'}
          </div>
        </div>
        <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted-foreground">
          <div>trace</div>
          <div className="truncate text-foreground">{trace.traceId}</div>
          <div>started</div>
          <div className="text-foreground">{new Date(trace.startedAt).toISOString()}</div>
          <div>status</div>
          <div className="text-foreground">{trace.status}</div>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1">
          {PHASE_ORDER.map((key) => {
            const ev = trace.phases[key]
            return (
              <div
                key={key}
                className={cn(
                  'rounded border px-1.5 py-1 text-[9px]',
                  ev === null
                    ? 'border-border bg-muted/20 text-muted-foreground'
                    : ev.status === 'error'
                      ? 'border-rose-500/40 bg-rose-500/10'
                      : ev.status === 'success'
                        ? 'border-emerald-500/40 bg-emerald-500/10'
                        : 'border-amber-500/40 bg-amber-500/10',
                )}
              >
                <div className="font-medium">{key}</div>
                <div className="tabular-nums text-muted-foreground">
                  {ev === null
                    ? 'missing'
                    : ev.durationMs !== null
                      ? `${ev.durationMs}ms`
                      : '—'}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-muted/10 px-2 py-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'h-6 rounded px-2 text-[10px] font-medium transition-colors',
              tab === t.key
                ? 'border border-border bg-background text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => {
            if (payloadText) {
              void navigator.clipboard.writeText(payloadText)
            }
          }}
          className="h-6 rounded border border-border bg-background px-2 text-[10px] hover:bg-muted/40"
        >
          Copy
        </button>
      </div>

      <pre className="flex-1 overflow-auto whitespace-pre-wrap break-all p-3 text-[11px] leading-5">
        {payloadText ? payloadText : <span className="text-muted-foreground">(empty)</span>}
      </pre>
    </div>
  )
}
