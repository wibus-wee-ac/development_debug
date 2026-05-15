import { useCallback, useEffect, useState } from 'react'

import { getServerUrl } from '~/lib/electron'

const SERVER_BASE = getServerUrl()

interface HealthData {
  status: string
  uptime: number
  memory: {
    heapUsed: number
    heapTotal: number
    rss: number
    external: number
  }
  timestamp: number
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${h}h ${m}m ${s}s`
}

export function HealthPanel() {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_BASE}/health`)
      if (!res.ok) {
        setError(`HTTP ${res.status}`)
        return
      }
      const data: HealthData = await res.json()
      setHealth(data)
      setError(null)
    }
    catch (err) {
      setError(String(err))
    }
  }, [])

  useEffect(() => {
    void fetchHealth()
    const id = setInterval(() => void fetchHealth(), 10_000)
    return () => clearInterval(id)
  }, [fetchHealth])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground/50">
        Failed to fetch server health:
{' '}
{error}
      </div>
    )
  }

  if (!health) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground/50">
        Loading…
      </div>
    )
  }

  const rows: [string, string][] = [
    ['Status', health.status],
    ['Uptime', formatUptime(health.uptime)],
    ['Heap Used', `${health.memory.heapUsed} MB`],
    ['Heap Total', `${health.memory.heapTotal} MB`],
    ['RSS', `${health.memory.rss} MB`],
    ['External', `${health.memory.external} MB`],
    ['Timestamp', new Date(health.timestamp).toLocaleTimeString('en-US', { hour12: false })],
  ]

  return (
    <div className="h-full overflow-auto p-4">
      <table className="w-full text-left font-mono text-[11px]">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-border">
              <td className="py-2 pr-6 text-muted-foreground">{label}</td>
              <td className="py-2 text-foreground">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
