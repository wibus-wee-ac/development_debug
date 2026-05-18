// Web plugin entry — runs in browser context
// Uses React via import map resolution (provided by host in dev + prod)
import { useState, useEffect } from 'react'

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

function SystemInfoPanel({ isActive }: { isActive: boolean }) {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchInfo = async () => {
    setLoading(true)
    setError(null)
    try {
      const serverUrl = (window as any).cradle?.env?.serverUrl
        ?? (import.meta as any).env?.VITE_SERVER_URL
        ?? 'http://127.0.0.1:21423'
      const res = await fetch(`${serverUrl}/api/plugins/system-info/info`)
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

interface PluginContext {
  registerPanel(panel: { id: string; title: string; component: any; location?: string }): unknown
  registerCommand(cmd: { id: string; title: string; execute: () => void | Promise<void> }): unknown
  logger: { info(msg: string, ...args: unknown[]): void }
  storage: { get(key: string): string | null; set(key: string, value: string): void }
}

export function activate(ctx: PluginContext): void {
  ctx.registerPanel({
    id: 'system-info-panel',
    title: 'System Info',
    component: SystemInfoPanel,
    location: 'sidebar',
  })

  ctx.registerCommand({
    id: 'system-info.show',
    title: 'Show System Info',
    async execute() {
      try {
        const serverUrl = (window as any).cradle?.env?.serverUrl
          ?? (import.meta as any).env?.VITE_SERVER_URL
          ?? 'http://127.0.0.1:21423'
        const response = await fetch(`${serverUrl}/api/plugins/system-info/info`)
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
