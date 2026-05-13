import { useEffect, useState } from 'react'

import { getPerfSnapshots, getWebVitals } from '~/lib/perf-monitor'

function toMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2)
}

export function MemoryPanel() {
  const [, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 5_000)
    return () => clearInterval(id)
  }, [])

  const snapshots = getPerfSnapshots()
  const vitals = getWebVitals()
  const latest = snapshots[snapshots.length - 1]
  const recentSnapshots = snapshots.slice(-10)

  return (
    <div className="h-full overflow-auto p-4 font-mono text-[11px]">
      <div className="mb-4">
        <div className="mb-2 text-xs text-muted-foreground">Current Heap Usage</div>
        {latest
          ? (
              <table className="w-full text-left">
                <tbody>
                  <tr className="border-b border-border/30">
                    <td className="py-1.5 pr-6 text-muted-foreground">Heap Used</td>
                    <td className="py-1.5 text-foreground">{toMB(latest.heapUsed)} MB</td>
                  </tr>
                  <tr className="border-b border-border/30">
                    <td className="py-1.5 pr-6 text-muted-foreground">Heap Total</td>
                    <td className="py-1.5 text-foreground">{toMB(latest.heapTotal)} MB</td>
                  </tr>
                  <tr className="border-b border-border/30">
                    <td className="py-1.5 pr-6 text-muted-foreground">Heap Limit</td>
                    <td className="py-1.5 text-foreground">{toMB(latest.heapLimit)} MB</td>
                  </tr>
                </tbody>
              </table>
            )
          : <div className="text-muted-foreground/50">No memory data available (requires Chromium with performance.memory)</div>}
      </div>

      {recentSnapshots.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 text-xs text-muted-foreground">Recent Trend (last {recentSnapshots.length} samples)</div>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-1.5 pr-3 font-normal">Time</th>
                <th className="py-1.5 pr-3 font-normal">Heap Used</th>
                <th className="py-1.5 font-normal">Heap Total</th>
              </tr>
            </thead>
            <tbody>
              {recentSnapshots.map((snap, i) => (
                <tr key={i} className="border-b border-border/30">
                  <td className="py-1 pr-3 text-muted-foreground">
                    {new Date(snap.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                  </td>
                  <td className="py-1 pr-3">{toMB(snap.heapUsed)} MB</td>
                  <td className="py-1">{toMB(snap.heapTotal)} MB</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {vitals.length > 0 && (
        <div>
          <div className="mb-2 text-xs text-muted-foreground">Web Vitals</div>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-1.5 pr-3 font-normal">Metric</th>
                <th className="py-1.5 pr-3 font-normal">Value</th>
                <th className="py-1.5 font-normal">Rating</th>
              </tr>
            </thead>
            <tbody>
              {vitals.map((v, i) => (
                <tr key={i} className="border-b border-border/30">
                  <td className="py-1 pr-3 text-muted-foreground">{v.name}</td>
                  <td className="py-1 pr-3">{v.value.toFixed(2)}</td>
                  <td className="py-1">{v.rating}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!latest && vitals.length === 0 && (
        <div className="text-xs text-muted-foreground/50">
          No performance data collected yet
        </div>
      )}
    </div>
  )
}
