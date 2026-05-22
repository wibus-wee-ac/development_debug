// Web plugin entry — runs in browser context
// Uses React via import map resolution (provided by host in dev + prod)
import { useState, useEffect } from 'react'
import type { WebPluginContext } from '@cradle/plugin-sdk/web'

interface SystemInfo {
  hostname: string
  platform: string
  arch: string
  cpuModel: string
  cpuCores: number
  totalMemoryGB: number
  freeMemoryGB: number
  usedMemoryGB: number
  memoryUsagePercent: number
  uptimeHours: number
  nodeVersion: string
}

function SystemInfoPanel({ isActive, routes }: { isActive: boolean; routes: WebPluginContext['routes'] }) {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchInfo = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await routes.fetch('/info')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setInfo(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isActive) fetchInfo()
  }, [isActive])

  if (loading) return <div className="p-4 text-muted-foreground">Loading...</div>
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>
  if (!info) return <div className="p-4 text-muted-foreground">No data</div>

  const rows: [string, string][] = [
    ['Hostname', info.hostname],
    ['Platform', `${info.platform} (${info.arch})`],
    ['CPU', `${info.cpuModel} (${info.cpuCores} cores)`],
    ['Memory', `${info.usedMemoryGB}/${info.totalMemoryGB} GB (${info.memoryUsagePercent}%)`],
    ['Uptime', `${info.uptimeHours} hours`],
    ['Node.js', info.nodeVersion],
  ]

  return (
    <div className="p-3 text-sm leading-relaxed">
      <div className="font-semibold mb-2">System Info</div>
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between py-0.5">
          <span className="text-muted-foreground">{label}</span>
          <span>{value}</span>
        </div>
      ))}
      <button
        onClick={fetchInfo}
        className="mt-3 px-3 py-1 cursor-pointer rounded border border-border bg-transparent text-foreground hover:bg-fill transition-colors"
      >
        Refresh
      </button>
    </div>
  )
}

export function activate(ctx: WebPluginContext): void {
  ctx.panels.register({
    id: 'system-info',
    title: 'System Info',
    component: props => <SystemInfoPanel {...props} routes={ctx.routes} />,
    location: 'sidebar',
  })

  ctx.commands.register({
    id: 'show',
    title: 'Show System Info',
    async execute() {
      try {
        const response = await ctx.routes.fetch('/info')
        if (!response.ok) {
          ctx.logger.info('Failed to fetch system info:', response.status.toString())
          return
        }
        const data = await response.json()
        ctx.logger.info('System Info:', data)
        ctx.storage.set('lastCheck', new Date().toISOString())
      } catch (err) {
        ctx.logger.info('Error fetching system info:', String(err))
      }
    },
  })

  ctx.logger.info('System Info plugin (web) activated')
}
