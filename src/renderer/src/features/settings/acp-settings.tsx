// Input: ipc proxy, RegistryAgent / AcpAgent types, coss UI primitives
// Output: AcpSettings component — browse registry, install/uninstall agents,
//         view audit log
// Position: Settings feature section for ACP agent management

import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Separator } from '@renderer/components/ui/separator'
import { Spinner } from '@renderer/components/ui/spinner'
import { ipc } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  PackageIcon,
  SearchIcon,
  Trash2Icon,
  XCircleIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

// ── Types (mirrored from main) ────────────────────────────────────────────────

interface RegistryAgent {
  id: string
  name: string
  version: string
  description: string
  repository?: string
  website?: string
  authors?: string[]
  license?: string
  icon?: string
  distribution: {
    binary?: Record<string, unknown>
    npx?: { package: string, args?: string[] }
    uvx?: { package: string, args?: string[] }
  }
}

interface AcpAgent {
  id: string
  name: string
  version: string
  distributionType: string
  installPath: string | null
  cmd: string | null
  args: string
  env: string
  status: string
  createdAt: number
  updatedAt: number
}

interface AcpAuditEntry {
  id: number
  agentId: string
  action: string
  path: string | null
  details: string
  createdAt: number
}

// ── Hook: Registry data ───────────────────────────────────────────────────────

function useAcpData() {
  const [registry, setRegistry] = useState<RegistryAgent[]>([])
  const [installed, setInstalled] = useState<AcpAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [reg, inst] = await Promise.all([
        ipc!.acp.fetchRegistry(),
        ipc!.acp.listInstalled(),
      ])
      setRegistry(reg as RegistryAgent[])
      setInstalled(inst as AcpAgent[])
    }
    catch (err) {
      setError(String(err))
    }
    finally {
      setLoading(false)
    }
  }, [])

  const refreshInstalled = useCallback(async () => {
    try {
      const inst = await ipc!.acp.listInstalled()
      setInstalled(inst as AcpAgent[])
    }
    catch { /* silent */ }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { registry, installed, loading, error, refresh, refreshInstalled }
}

// ── Sub-view: Audit Log ───────────────────────────────────────────────────────

function AuditLogView({ agentId, onBack }: { agentId: string, onBack: () => void }) {
  const [entries, setEntries] = useState<AcpAuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    ipc!.acp.getAuditLog(agentId)
      .then((data: unknown) => setEntries(data as AcpAuditEntry[]))
      .finally(() => setLoading(false))
  }, [agentId])

  const formatTime = (ts: number) => {
    return new Date(ts * 1000).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  const actionLabels: Record<string, { label: string, color: string }> = {
    install_start: { label: '开始安装', color: 'text-blue-500' },
    file_download: { label: '文件下载', color: 'text-blue-400' },
    file_extract: { label: '文件解压', color: 'text-blue-400' },
    file_chmod: { label: '权限设置', color: 'text-blue-400' },
    install_complete: { label: '安装完成', color: 'text-emerald-500' },
    install_failed: { label: '安装失败', color: 'text-red-500' },
    uninstall_start: { label: '开始卸载', color: 'text-amber-500' },
    file_delete: { label: '文件删除', color: 'text-amber-400' },
    uninstall_complete: { label: '卸载完成', color: 'text-emerald-500' },
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          ← 返回
        </button>
        <Separator orientation="vertical" className="h-4" />
        <span className="text-sm font-medium">
          审计日志 ·
          {agentId}
        </span>
      </div>

      {loading
        ? (
            <div className="flex items-center justify-center py-12">
              <Spinner className="size-4 text-muted-foreground" />
            </div>
          )
        : entries.length === 0
          ? (
              <p className="py-12 text-center text-sm text-muted-foreground">暂无审计记录</p>
            )
          : (
              <div className="relative flex flex-col">
                {/* Timeline */}
                {entries.map((entry, i) => {
                  const info = actionLabels[entry.action] ?? { label: entry.action, color: 'text-muted-foreground' }
                  const isLast = i === entries.length - 1
                  let details: Record<string, unknown> = {}
                  try {
                    details = JSON.parse(entry.details)
                  }
                  catch { /* noop */ }

                  return (
                    <div key={entry.id} className="relative flex gap-3 pb-4">
                      {/* Timeline line */}
                      {!isLast && (
                        <div className="absolute top-5 left-1.75 h-[calc(100%-12px)] w-px bg-border" />
                      )}
                      {/* Dot */}
                      <div className={cn('mt-1.5 size-3.75 shrink-0 rounded-full border-2 border-background', info.color === 'text-emerald-500' ? 'bg-emerald-500' : info.color === 'text-red-500' ? 'bg-red-500' : info.color === 'text-amber-500' ? 'bg-amber-500' : 'bg-muted-foreground')} />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className={cn('text-sm font-medium', info.color)}>{info.label}</span>
                          <span className="text-xs text-muted-foreground">{formatTime(entry.createdAt)}</span>
                        </div>
                        {entry.path && (
                          <p className="truncate font-mono text-xs text-muted-foreground">{entry.path}</p>
                        )}
                        {Object.keys(details).length > 0 && (
                          <p className="truncate text-xs text-muted-foreground/70">
                            {Object.entries(details).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
    </div>
  )
}

// ── Agent card ────────────────────────────────────────────────────────────────

function AgentCard({
  agent,
  installedRecord,
  onInstall,
  onUninstall,
  onAudit,
  busy,
}: {
  agent: RegistryAgent
  installedRecord?: AcpAgent
  onInstall: (type: 'binary' | 'npx' | 'uvx') => void
  onUninstall: () => void
  onAudit: () => void
  busy: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  const distTypes = useMemo(() => {
    const out: Array<'binary' | 'npx' | 'uvx'> = []
    if (agent.distribution.binary) {
      out.push('binary')
    }
    if (agent.distribution.npx) {
      out.push('npx')
    }
    if (agent.distribution.uvx) {
      out.push('uvx')
    }
    return out
  }, [agent])

  const isInstalled = installedRecord?.status === 'installed'
  const isInstalling = installedRecord?.status === 'installing'
  const isFailed = installedRecord?.status === 'failed'

  const statusNode = isInstalled
    ? (
        <Badge size="sm" variant="success">
          <CheckCircle2Icon className="size-3" />
          已安装
        </Badge>
      )
    : isInstalling
      ? (
          <Badge size="sm" variant="info">
            <ClockIcon className="size-3" />
            安装中
          </Badge>
        )
      : isFailed
        ? (
            <Badge size="sm" variant="error">
              <XCircleIcon className="size-3" />
              失败
            </Badge>
          )
        : null

  return (
    <div className="group relative rounded-xl border bg-card/50 transition-colors hover:bg-card">
      {/* Header row */}
      <div className="flex items-start gap-3 p-4">
        {/* Icon */}
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background">
          {agent.icon
            ? <img src={agent.icon} alt="" className="size-5" />
            : <PackageIcon className="size-4 text-muted-foreground" />}
        </div>

        {/* Info */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold leading-tight">{agent.name}</span>
            <span className="font-mono text-xs text-muted-foreground">
              v
              {agent.version}
            </span>
            {statusNode}
          </div>
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {agent.description}
          </p>

          {/* Meta row */}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {agent.license && (
              <span className="text-xs text-muted-foreground/70">{agent.license}</span>
            )}
            {agent.authors && agent.authors.length > 0 && (
              <span className="text-xs text-muted-foreground/70">
                {agent.authors.join(', ')}
              </span>
            )}
            {/* Distribution badges */}
            <div className="flex gap-1">
              {distTypes.map(t => (
                <span
                  key={t}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1">
          {isInstalled
            ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={onAudit}
                  >
                    <FileTextIcon className="size-3.5" />
                  </Button>
                  <Button
                    variant="destructive-outline"
                    size="xs"
                    onClick={onUninstall}
                    loading={busy}
                  >
                    <Trash2Icon className="size-3" />
                    卸载
                  </Button>
                </>
              )
            : (
                <>
                  {distTypes.length === 1
                    ? (
                        <Button
                          variant="default"
                          size="xs"
                          onClick={() => onInstall(distTypes[0])}
                          loading={busy || isInstalling}
                        >
                          <DownloadIcon className="size-3" />
                          安装
                        </Button>
                      )
                    : (
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => setExpanded(!expanded)}
                          loading={busy || isInstalling}
                        >
                          <DownloadIcon className="size-3" />
                          安装
                          <ChevronDownIcon className={cn('size-3 transition-transform', expanded && 'rotate-180')} />
                        </Button>
                      )}
                </>
              )}

          {(agent.repository || agent.website) && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => {
                const url = agent.website || agent.repository
                if (url) {
                  window.open(url, '_blank')
                }
              }}
            >
              <ExternalLinkIcon className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Expanded installer row */}
      {expanded && !isInstalled && distTypes.length > 1 && (
        <div className="flex items-center gap-2 border-t px-4 py-2.5">
          <span className="text-xs text-muted-foreground">安装方式：</span>
          {distTypes.map(t => (
            <Button
              key={t}
              variant="outline"
              size="xs"
              onClick={() => {
                onInstall(t)
                setExpanded(false)
              }}
              loading={busy}
            >
              {t === 'binary' ? '二进制' : t}
            </Button>
          ))}
        </div>
      )}

      {/* Installed details */}
      {isInstalled && installedRecord && (
        <div className="border-t px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground/60">
            <span>
              类型:
              {installedRecord.distributionType}
            </span>
            {installedRecord.installPath && (
              <span className="truncate">
                路径:
                {installedRecord.installPath}
              </span>
            )}
            {installedRecord.cmd && (
              <span>
                命令:
                {installedRecord.cmd}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main ACP Settings ─────────────────────────────────────────────────────────

type ViewState = { view: 'list' } | { view: 'audit', agentId: string }

export function AcpSettings() {
  const { registry, installed, loading, error, refresh, refreshInstalled } = useAcpData()
  const [query, setQuery] = useState('')
  const [busyAgent, setBusyAgent] = useState<string | null>(null)
  const [viewState, setViewState] = useState<ViewState>({ view: 'list' })
  const [filter, setFilter] = useState<'all' | 'installed'>('all')

  const installedMap = useMemo(() => {
    const map = new Map<string, AcpAgent>()
    for (const a of installed) {
      map.set(a.id, a)
    }
    return map
  }, [installed])

  const filteredAgents = useMemo(() => {
    let agents = registry
    if (filter === 'installed') {
      agents = agents.filter(a => installedMap.has(a.id))
    }
    if (query.trim()) {
      const q = query.toLowerCase()
      agents = agents.filter(
        a =>
          a.name.toLowerCase().includes(q)
          || a.id.toLowerCase().includes(q)
          || a.description.toLowerCase().includes(q),
      )
    }
    return agents
  }, [registry, query, filter, installedMap])

  const handleInstall = async (agentId: string, distType: 'binary' | 'npx' | 'uvx') => {
    setBusyAgent(agentId)
    try {
      await ipc!.acp.install(agentId, distType)
    }
    catch { /* error is persisted in DB */ }
    finally {
      await refreshInstalled()
      setBusyAgent(null)
    }
  }

  const handleUninstall = async (agentId: string) => {
    setBusyAgent(agentId)
    try {
      await ipc!.acp.uninstall(agentId)
    }
    catch { /* noop */ }
    finally {
      await refreshInstalled()
      setBusyAgent(null)
    }
  }

  // Audit sub-view
  if (viewState.view === 'audit') {
    return (
      <AuditLogView
        agentId={viewState.agentId}
        onBack={() => setViewState({ view: 'list' })}
      />
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h3 className="font-heading text-base font-semibold">代理 (ACP)</h3>
        <p className="text-sm text-muted-foreground">
          从 ACP 注册表浏览和安装编码代理，所有文件写入操作均记录审计日志
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        {/* Search */}
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索代理…"
            className="h-8 w-full rounded-lg border bg-background pl-8 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Filter tabs */}
        <div className="flex rounded-lg border bg-muted/50 p-0.5">
          {(['all', 'installed'] as const).map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-all',
                filter === f
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f === 'all' ? '全部' : `已安装 (${installed.length})`}
            </button>
          ))}
        </div>

        {/* Refresh */}
        <Button variant="ghost" size="icon-xs" onClick={refresh}>
          <svg className={cn('size-3.5', loading && 'animate-spin')} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
        </Button>
      </div>

      <Separator />

      {/* Content */}
      {loading
        ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16">
              <Spinner className="size-5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">正在加载注册表…</span>
            </div>
          )
        : error
          ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16">
                <XCircleIcon className="size-6 text-destructive" />
                <p className="max-w-xs text-center text-sm text-muted-foreground">{error}</p>
                <Button variant="outline" size="xs" onClick={refresh}>重试</Button>
              </div>
            )
          : filteredAgents.length === 0
            ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16">
                  <PackageIcon className="size-6 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">
                    {query ? '没有找到匹配的代理' : '注册表为空'}
                  </p>
                </div>
              )
            : (
                <div className="flex flex-col gap-2">
                  {filteredAgents.map(agent => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      installedRecord={installedMap.get(agent.id)}
                      onInstall={type => handleInstall(agent.id, type)}
                      onUninstall={() => handleUninstall(agent.id)}
                      onAudit={() => setViewState({ view: 'audit', agentId: agent.id })}
                      busy={busyAgent === agent.id}
                    />
                  ))}
                </div>
              )}

      {/* Footer: audit log link for all */}
      {!loading && installed.length > 0 && (
        <>
          <Separator />
          <button
            type="button"
            onClick={() => setViewState({ view: 'audit', agentId: '' })}
            className="flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <FileTextIcon className="size-3.5" />
            查看全部审计日志
            <ChevronRightIcon className="size-3" />
          </button>
        </>
      )}
    </div>
  )
}
