// Input: ACP SDK functions, RegistryAgent/AcpAgent types, coss UI primitives
// Output: AcpSettings component — browse ACP registry, install/uninstall agents, view audit log
// Position: Settings section for ACP agent management

import {
  CheckCircle2Icon,
  ChevronDownIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  PackageIcon,
  RotateCwIcon,
  SearchIcon,
  Trash2Icon,
  XCircleIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  deleteAcpAgentsByAgentId,
  deleteAcpAgentsByAgentIdInstallation,
  getAcpAgents,
  getAcpAudit,
  getAcpRegistry,
  putAcpAgentsByAgentIdInstallation,
} from '~/api-gen/sdk.gen'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Separator } from '~/components/ui/separator'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'
import type { AcpAgent, RegistryAgent } from '~/lib/types'

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useAcpData() {
  const [registry, setRegistry] = useState<RegistryAgent[]>([])
  const [installed, setInstalled] = useState<AcpAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [{ data: reg }, { data: inst }] = await Promise.all([
        getAcpRegistry(),
        getAcpAgents(),
      ])
      setRegistry((reg ?? []) as RegistryAgent[])
      setInstalled((inst ?? []) as AcpAgent[])
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
      const { data: inst } = await getAcpAgents()
      setInstalled((inst ?? []) as AcpAgent[])
    }
    catch { /* silent */ }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { registry, installed, loading, error, refresh, refreshInstalled }
}

// ── Audit Log ─────────────────────────────────────────────────────────────────

interface AcpAuditEntry {
  id: number
  agentId: string
  action: string
  path: string | null
  details: string
  createdAt: number
}

const ACTION_LABELS: Record<string, string> = {
  install_start: 'Install started',
  file_download: 'File downloaded',
  file_extract: 'File extracted',
  file_chmod: 'Permissions set',
  install_complete: 'Installed',
  install_failed: 'Install failed',
  uninstall_start: 'Uninstall started',
  file_delete: 'File deleted',
  uninstall_complete: 'Uninstalled',
}

function AuditLogView({ agentId, onBack }: { agentId: string, onBack: () => void }) {
  const [entries, setEntries] = useState<AcpAuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getAcpAudit({ query: { agentId: agentId || undefined } })
      .then(({ data }) => setEntries((data ?? []) as AcpAuditEntry[]))
      .finally(() => setLoading(false))
  }, [agentId])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Back
        </button>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm font-medium">
          Audit log
          {agentId ? ` · ${agentId}` : ''}
        </span>
      </div>

      {loading
        ? (
          <div className="flex items-center justify-center py-16">
            <Spinner className="size-4 text-muted-foreground" />
          </div>
        )
        : entries.length === 0
          ? (
            <p className="py-16 text-center text-sm text-muted-foreground">No audit records</p>
          )
          : (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Action</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Path</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const label = ACTION_LABELS[entry.action] ?? entry.action
                    return (
                      <tr key={entry.id} className="border-b last:border-b-0">
                        <td className="whitespace-nowrap px-4 py-2.5 text-xs">{label}</td>
                        <td className="max-w-64 truncate px-4 py-2.5 font-mono text-xs text-muted-foreground">
                          {entry.path ?? '—'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">
                          {new Date(entry.createdAt * 1000).toLocaleString()}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
    </div>
  )
}

// ── Agent row ─────────────────────────────────────────────────────────────────

function AgentRow({
  agent,
  record,
  onInstall,
  onUninstall,
  onCancelInstall,
  onAudit,
  busy,
}: {
  agent: RegistryAgent
  record?: AcpAgent
  onInstall: (type: 'binary' | 'npx' | 'uvx') => void
  onUninstall: () => void
  onCancelInstall: () => void
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

  const isInstalled = record?.status === 'installed'
  const isInstalling = record?.status === 'installing'
  const isFailed = record?.status === 'failed'

  return (
    <div data-testid={`acp-agent-row-${agent.id}`}>
      <div className="flex items-start gap-4 py-4">
        {/* Icon */}
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/50">
          {agent.icon
            ? <img src={agent.icon} alt="" className="size-4 dark:invert" />
            : <PackageIcon className="size-3.5 text-muted-foreground" />}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{agent.name}</span>
            <span className="font-mono text-xs text-muted-foreground">
              v
              {agent.version}
            </span>
            {isInstalled && (
              <Badge
                variant="secondary"
                className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              >
                <CheckCircle2Icon className="size-3" />
                Installed
              </Badge>
            )}
            {isInstalling && (
              <Badge
                variant="outline"
                className="border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-400"
              >
                <Spinner className="size-3" />
                Installing…
              </Badge>
            )}
            {isFailed && (
              <Badge variant="destructive">
                <XCircleIcon className="size-3" />
                Failed
              </Badge>
            )}
            <div className="flex gap-1">
              {distTypes.map(t => (
                <span key={t} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{t}</span>
              ))}
            </div>
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{agent.description}</p>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1">
          {isInstalled
            ? (
              <>
                <Button variant="ghost" size="icon-xs" onClick={onAudit} title="Audit log">
                  <FileTextIcon className="size-3.5" />
                </Button>
                <Button variant="ghost" size="xs" onClick={onUninstall} disabled={busy}>
                  {busy
                    ? <Spinner className="size-3" />
                    : <Trash2Icon className="size-3" />}
                  Uninstall
                </Button>
              </>
            )
            : isInstalling
              ? (
                <Button variant="ghost" size="xs" onClick={onCancelInstall}>
                  Cancel
                </Button>
              )
              : distTypes.length === 1
                ? (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => onInstall(distTypes[0])}
                    disabled={busy || isInstalling}
                  >
                    {busy || isInstalling
                      ? <Spinner className="size-3" />
                      : <DownloadIcon className="size-3" />}
                    Install
                  </Button>
                )
                : (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => setExpanded(e => !e)}
                    disabled={busy || isInstalling}
                  >
                    {busy || isInstalling
                      ? <Spinner className="size-3" />
                      : <DownloadIcon className="size-3" />}
                    Install
                    <ChevronDownIcon className={cn('size-3 transition-transform', expanded && 'rotate-180')} />
                  </Button>
                )}

          {(agent.repository || agent.website) && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => window.open((agent.website || agent.repository)!, '_blank')}
            >
              <ExternalLinkIcon className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Expanded install options */}
      {expanded && !isInstalled && distTypes.length > 1 && (
        <div className="mb-3 ml-12 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Install via:</span>
          {distTypes.map(t => (
            <Button
              key={t}
              variant="outline"
              size="xs"
              onClick={() => {
                onInstall(t)
                setExpanded(false)
              }}
              disabled={busy}
            >
              {busy && <Spinner className="size-3" />}
              {t === 'binary' ? 'Binary' : t}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

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

  const handleInstall = useCallback(async (agentId: string, distType: 'binary' | 'npx' | 'uvx') => {
    setBusyAgent(agentId)
    try {
      await putAcpAgentsByAgentIdInstallation({
        path: { agentId },
        body: { distType } as unknown as never,
      })
    }
    catch { /* persisted in DB */ }
    finally {
      await refreshInstalled()
      setBusyAgent(null)
    }
  }, [refreshInstalled])

  const handleCancelInstall = useCallback(async (agentId: string) => {
    try {
      await deleteAcpAgentsByAgentIdInstallation({ path: { agentId } })
    }
    catch { /* noop */ }
    finally {
      await refreshInstalled()
    }
  }, [refreshInstalled])

  const handleUninstall = useCallback(async (agentId: string) => {
    setBusyAgent(agentId)
    try {
      await deleteAcpAgentsByAgentId({ path: { agentId } })
    }
    catch { /* noop */ }
    finally {
      await refreshInstalled()
      setBusyAgent(null)
    }
  }, [refreshInstalled])

  if (viewState.view === 'audit') {
    return (
      <AuditLogView
        agentId={viewState.agentId}
        onBack={() => setViewState({ view: 'list' })}
      />
    )
  }

  return (
    <div className="flex flex-col gap-6" data-testid="acp-settings">
      {/* Header */}
      <div>
        <h3 className="text-base font-semibold tracking-tight">ACP Registry</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse and install ACP-compatible coding agents. All file operations are audit-logged.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value) }}
            placeholder="Search agents…"
            data-testid="acp-search-input"
            className="h-8 w-full rounded-md border bg-background pl-8 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="flex rounded-md border bg-muted/50 p-0.5">
          {(['all', 'installed'] as const).map(f => (
            <button
              key={f}
              type="button"
              onClick={() => { setFilter(f) }}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium transition-all',
                filter === f
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f === 'all' ? 'All' : `Installed (${installed.length})`}
            </button>
          ))}
        </div>

        <Button variant="ghost" size="icon-xs" onClick={refresh} disabled={loading}>
          <RotateCwIcon className={cn('size-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      <Separator />

      {/* Content */}
      {loading
        ? (
          <div className="flex items-center justify-center py-16">
            <Spinner className="size-4 text-muted-foreground" />
          </div>
        )
        : error
          ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <XCircleIcon className="size-5 text-destructive" />
              <p className="max-w-xs text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" size="xs" onClick={refresh}>Retry</Button>
            </div>
          )
          : filteredAgents.length === 0
            ? (
              <div className="flex flex-col items-center gap-2 py-16 text-center">
                <PackageIcon className="size-5 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {query ? 'No agents match your search' : 'Registry is empty'}
                </p>
              </div>
            )
            : (
              <div className="divide-y" data-testid="acp-agent-list">
                {filteredAgents.map(agent => (
                  <AgentRow
                    key={agent.id}
                    agent={agent}
                    record={installedMap.get(agent.id)}
                    onInstall={(type) => { handleInstall(agent.id, type) }}
                    onUninstall={() => { handleUninstall(agent.id) }}
                    onCancelInstall={() => { handleCancelInstall(agent.id) }}
                    onAudit={() => { setViewState({ view: 'audit', agentId: agent.id }) }}
                    busy={busyAgent === agent.id}
                  />
                ))}
              </div>
            )}

      {/* Footer audit link */}
      {!loading && installed.length > 0 && (
        <>
          <Separator />
          <button
            type="button"
            onClick={() => { setViewState({ view: 'audit', agentId: '' }) }}
            className="flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <FileTextIcon className="size-3.5" />
            View all audit logs
          </button>
        </>
      )}
    </div>
  )
}
