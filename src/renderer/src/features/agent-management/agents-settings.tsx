// Input: ipc.acp + ipc.agentRuntime methods, coss UI primitives, lucide icons
// Output: AgentsSettings — unified Marketplace page for ACP Registry + manual agent profiles
// Position: Settings section replacing separate acp-settings and agent-runtime-settings

import type { AcpAgent, AgentProfile, ProviderKind, RegistryAgent } from '@main/ipc-types'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { Separator } from '@renderer/components/ui/separator'
import { Spinner } from '@renderer/components/ui/spinner'
import { cn } from '@renderer/lib/cn'
import { ipc } from '@renderer/lib/ipc'
import {
  BotIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleDotIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  KeyRoundIcon,
  PackageIcon,
  PlusIcon,
  RotateCwIcon,
  SearchIcon,
  Trash2Icon,
  XCircleIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AcpAuditEntry {
  id: number
  agentId: string
  action: string
  path: string | null
  details: string
  createdAt: number
}

// ── ACP Data hook ─────────────────────────────────────────────────────────────

function useAcpData() {
  const [registry, setRegistry] = useState<RegistryAgent[]>([])
  const [installed, setInstalled] = useState<AcpAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!ipc) {
      return
    }
    try {
      setLoading(true)
      setError(null)
      const [reg, inst] = await Promise.all([
        ipc.acp.fetchRegistry(),
        ipc.acp.listInstalled(),
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
    if (!ipc) {
      return
    }
    try {
      const inst = await ipc.acp.listInstalled()
      setInstalled(inst as AcpAgent[])
    }
    catch { /* silent */ }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { registry, installed, loading, error, refresh, refreshInstalled }
}

// ── Agent Profiles hook ───────────────────────────────────────────────────────

function useAgentProfiles() {
  const [profiles, setProfiles] = useState<AgentProfile[]>([])

  const refresh = useCallback(async () => {
    if (!ipc) {
      return
    }
    setProfiles(await ipc.agentRuntime.listProfiles() as AgentProfile[])
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { profiles, refresh }
}

// ── Audit Log view ────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  install_start: 'Install started',
  file_download: 'File downloaded',
  file_extract: 'Files extracted',
  file_chmod: 'Permissions set',
  install_complete: 'Installed',
  install_failed: 'Install failed',
  uninstall_start: 'Uninstall started',
  file_delete: 'Files deleted',
  uninstall_complete: 'Uninstalled',
}

function AuditLogView({ agentId, onBack }: { agentId: string, onBack: () => void }) {
  const [entries, setEntries] = useState<AcpAuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!ipc) {
      return
    }
    setLoading(true)
    ipc.acp.getAuditLog(agentId || undefined)
      .then((data: unknown) => { setEntries(data as AcpAuditEntry[]) })
      .finally(() => { setLoading(false) })
  }, [agentId])

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2 text-sm">
        <button type="button" onClick={onBack} className="text-muted-foreground transition-colors hover:text-foreground">
          ← Back
        </button>
        <span className="text-muted-foreground">/</span>
        <span className="font-medium">
          Audit log
          {agentId ? ` · ${agentId}` : ''}
        </span>
      </div>

      {loading
        ? <div className="flex justify-center py-12"><Spinner className="size-4 text-muted-foreground" /></div>
        : entries.length === 0
          ? <p className="py-12 text-center text-sm text-muted-foreground">No audit records</p>
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
                  {entries.map(entry => (
                    <tr key={entry.id} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs">{ACTION_LABELS[entry.action] ?? entry.action}</td>
                      <td className="max-w-64 truncate px-4 py-2.5 font-mono text-xs text-muted-foreground">{entry.path ?? '—'}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">
                        {new Date(entry.createdAt * 1000).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </div>
  )
}

// ── Registry agent card ───────────────────────────────────────────────────────

function RegistryAgentCard({
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
  const [showDistOptions, setShowDistOptions] = useState(false)

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
    <div
      className="group relative rounded-xl border bg-card transition-all hover:shadow-sm"
      data-testid={`acp-agent-card-${agent.id}`}
    >
      <div className="flex flex-col gap-3 p-4">
        {/* Top bar */}
        <div className="flex items-start justify-between gap-3">
          {/* Icon + name */}
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background">
              {agent.icon
                ? <img src={agent.icon} alt="" className="size-5 dark:invert" />
                : <PackageIcon className="size-4 text-muted-foreground" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{agent.name}</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  v
                  {agent.version}
                </span>
              </div>
              {agent.authors && agent.authors.length > 0 && (
                <p className="text-xs text-muted-foreground">{agent.authors.join(', ')}</p>
              )}
            </div>
          </div>

          {/* Status + actions */}
          <div className="flex shrink-0 items-center gap-1.5">
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

            {isInstalled
              ? (
                <>
                  <Button variant="ghost" size="icon-xs" onClick={onAudit} title="View logs">
                    <FileTextIcon className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="xs" onClick={onUninstall} disabled={busy}>
                    {busy
                      ? <Spinner className="size-3" />
                      : <Trash2Icon className="size-3" />}
                    Remove
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
                      variant="default"
                      size="xs"
                      onClick={() => { onInstall(distTypes[0]) }}
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
                      onClick={() => { setShowDistOptions(s => !s) }}
                      disabled={busy || isInstalling}
                    >
                      {busy || isInstalling
                        ? <Spinner className="size-3" />
                        : <DownloadIcon className="size-3" />}
                      Install
                      <ChevronDownIcon className={cn('size-3 transition-transform', showDistOptions && 'rotate-180')} />
                    </Button>
                  )}

            {(agent.repository || agent.website) && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => { window.open((agent.website || agent.repository)!, '_blank') }}
              >
                <ExternalLinkIcon className="size-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Description */}
        <p className="text-xs leading-relaxed text-muted-foreground">{agent.description}</p>

        {/* Meta chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {distTypes.map(t => (
            <span key={t} className="rounded-md bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
              {t}
            </span>
          ))}
          {agent.license && (
            <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              {agent.license}
            </span>
          )}
        </div>

        {/* Expanded install options */}
        {showDistOptions && !isInstalled && distTypes.length > 1 && (
          <div className="flex items-center gap-2 border-t pt-3">
            <span className="text-xs text-muted-foreground">Install via:</span>
            {distTypes.map(t => (
              <Button
                key={t}
                variant="outline"
                size="xs"
                onClick={() => {
                  onInstall(t)
                  setShowDistOptions(false)
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
    </div>
  )
}

// ── Manual profile form ───────────────────────────────────────────────────────

const PROVIDER_KINDS: Array<{ id: ProviderKind, label: string, description: string }> = [
  { id: 'openai-compatible', label: 'OpenAI-compatible', description: 'Any OpenAI-compatible REST API' },
  { id: 'acp-chat', label: 'ACP Chat', description: 'Custom ACP agent via npx or global install' },
  { id: 'cli-tui', label: 'CLI / TUI', description: 'Terminal-based interactive AI tool' },
]

interface OpenAIFields { name: string, baseUrl: string, model: string, apiKey: string }
interface AcpFields { name: string, packageName: string, distributionType: 'npx' | 'global' }
interface CliTuiFields { name: string, command: string }

type ProviderFields
  = | { kind: 'openai-compatible', fields: OpenAIFields }
  | { kind: 'acp-chat', fields: AcpFields }
  | { kind: 'cli-tui', fields: CliTuiFields }

const DEFAULT_NAMES: Record<ProviderKind, string> = {
  'openai-compatible': 'OpenAI-compatible',
  'acp-chat': 'Local ACP',
  'cli-tui': 'Local CLI',
}

function defaultFields(kind: ProviderKind): ProviderFields {
  switch (kind) {
    case 'openai-compatible': return { kind, fields: { name: DEFAULT_NAMES[kind], baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', apiKey: '' } }
    case 'acp-chat': return { kind, fields: { name: DEFAULT_NAMES[kind], packageName: '', distributionType: 'npx' } }
    case 'cli-tui': return { kind, fields: { name: DEFAULT_NAMES[kind], command: 'claude' } }
  }
}

function buildConfigJson(pf: ProviderFields): string {
  switch (pf.kind) {
    case 'openai-compatible': return JSON.stringify({ baseUrl: pf.fields.baseUrl, model: pf.fields.model })
    case 'acp-chat': return JSON.stringify({ distributionType: pf.fields.distributionType, cmd: pf.fields.packageName, args: [] })
    case 'cli-tui': return JSON.stringify({ executable: pf.fields.command, args: [] })
  }
}

const WHITESPACE_RE = /\s+/g

function buildProfileId(name: string, kind: ProviderKind): string {
  const base = name.trim().toLowerCase().replace(WHITESPACE_RE, '-')
  return base || kind
}

function ProfileForm({ form, setForm }: { form: ProviderFields, setForm: (f: ProviderFields) => void }) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="pf-kind">Type</Label>
        <Select
          value={form.kind}
          onValueChange={(value) => {
            setForm(defaultFields(value as ProviderKind))
          }}
        >
          <SelectTrigger id="pf-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDER_KINDS.map(k => (
              <SelectItem key={k.id} value={k.id}>
                <span className="font-medium">{k.label}</span>
                <span className="ml-2 text-xs text-muted-foreground">{k.description}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="pf-name">Name</Label>
        <Input
          id="pf-name"
          value={form.fields.name}
          onChange={(e) => {
            setForm({ ...form, fields: { ...form.fields, name: e.target.value } } as ProviderFields)
          }}
        />
      </div>

      {form.kind === 'openai-compatible' && (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="pf-baseurl">Base URL</Label>
            <Input
              id="pf-baseurl"
              value={form.fields.baseUrl}
              onChange={(e) => { setForm({ kind: form.kind, fields: { ...form.fields, baseUrl: e.target.value } }) }}
              placeholder="https://api.openai.com/v1"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pf-model">Model</Label>
            <Input
              id="pf-model"
              value={form.fields.model}
              onChange={(e) => { setForm({ kind: form.kind, fields: { ...form.fields, model: e.target.value } }) }}
              placeholder="gpt-4o"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pf-apikey">
              <KeyRoundIcon className="size-3" />
              API Key
            </Label>
            <Input
              id="pf-apikey"
              type="password"
              value={form.fields.apiKey}
              onChange={(e) => { setForm({ kind: form.kind, fields: { ...form.fields, apiKey: e.target.value } }) }}
              placeholder="sk-…"
            />
          </div>
        </>
      )}

      {form.kind === 'acp-chat' && (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="pf-dist">Distribution</Label>
            <Select
              value={form.fields.distributionType}
              onValueChange={(value) => {
                setForm({
                  kind: form.kind,
                  fields: { ...form.fields, distributionType: value as AcpFields['distributionType'] },
                })
              }}
            >
              <SelectTrigger id="pf-dist">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="npx">npx (no install needed)</SelectItem>
                <SelectItem value="global">Global install</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pf-pkg">Package / Command</Label>
            <Input
              id="pf-pkg"
              value={form.fields.packageName}
              onChange={(e) => { setForm({ kind: form.kind, fields: { ...form.fields, packageName: e.target.value } }) }}
              placeholder="@anthropic/claude-code"
            />
          </div>
        </>
      )}

      {form.kind === 'cli-tui' && (
        <div className="grid gap-1.5">
          <Label htmlFor="pf-cmd">Command</Label>
          <Input
            id="pf-cmd"
            value={form.fields.command}
            onChange={(e) => { setForm({ kind: form.kind, fields: { ...form.fields, command: e.target.value } }) }}
            placeholder="claude"
          />
        </div>
      )}
    </div>
  )
}

// ── Profile row ───────────────────────────────────────────────────────────────

const KIND_LABELS: Record<ProviderKind, string> = {
  'openai-compatible': 'OpenAI-compatible',
  'acp-chat': 'ACP',
  'cli-tui': 'CLI',
}

function ProfileRow({ profile, onRemove, onToggle }: { profile: AgentProfile, onRemove: () => void, onToggle: () => void }) {
  const [status, setStatus] = useState<{ ok: boolean | null, text: string | null }>({ ok: null, text: null })
  const [probing, setProbing] = useState(false)

  const probe = useCallback(async () => {
    if (!ipc) {
      return
    }
    setProbing(true)
    try {
      const result = await ipc.agentRuntime.probeProfile(profile.id)
      setStatus({ ok: result.ok, text: result.ok ? 'Ready' : (result.errorText ?? 'Not available') })
    }
    catch {
      setStatus({ ok: false, text: 'Probe failed' })
    }
    finally {
      setProbing(false)
    }
  }, [profile.id])

  return (
    <div className={cn(
      'flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-opacity',
      !profile.enabled && 'opacity-60',
    )}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/50">
        <BotIcon className="size-4 text-muted-foreground" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{profile.name}</span>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {KIND_LABELS[profile.providerKind] ?? profile.providerKind}
          </span>
        </div>
        {status.text && (
          <p className={cn('mt-0.5 text-xs', status.ok ? 'text-green-600 dark:text-green-400' : 'text-destructive')}>
            {status.text}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="xs" onClick={probe} disabled={probing}>
          {probing
            ? <Spinner className="size-3" />
            : <CircleDotIcon className="size-3" />}
          Test
        </Button>
        {/* Enable/disable toggle */}
        <button
          type="button"
          role="switch"
          aria-checked={profile.enabled}
          onClick={onToggle}
          className={cn(
            'relative inline-flex h-4.5 w-8 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
            profile.enabled ? 'bg-primary' : 'bg-muted-foreground/30',
          )}
          title={profile.enabled ? 'Disable' : 'Enable'}
        >
          <span
            className={cn(
              'pointer-events-none inline-block size-3.5 rounded-full bg-white shadow-sm ring-0 transition-transform',
              profile.enabled ? 'translate-x-3.5' : 'translate-x-0',
            )}
          />
        </button>
        <Button variant="ghost" size="icon-xs" onClick={onRemove} aria-label="Remove">
          <Trash2Icon className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type SubView = { view: 'main' } | { view: 'audit', agentId: string }

export function AgentsSettings() {
  // ACP data
  const { registry, installed, loading: registryLoading, error: registryError, refresh: refreshRegistry, refreshInstalled } = useAcpData()
  const [busyAgent, setBusyAgent] = useState<string | null>(null)

  // Profile data
  const { profiles, refresh: refreshProfiles } = useAgentProfiles()

  // UI state
  const [subView, setSubView] = useState<SubView>({ view: 'main' })
  const [query, setQuery] = useState('')
  const [registryFilter, setRegistryFilter] = useState<'all' | 'installed'>('all')

  // Add profile form
  const [addingProfile, setAddingProfile] = useState(false)
  const [form, setForm] = useState<ProviderFields>(() => defaultFields('openai-compatible'))
  const [busyAdd, setBusyAdd] = useState(false)
  const [addStatus, setAddStatus] = useState<{ ok: boolean, text: string } | null>(null)

  const installedMap = useMemo(() => {
    const map = new Map<string, AcpAgent>()
    for (const a of installed) {
      map.set(a.id, a)
    }
    return map
  }, [installed])

  const filteredRegistry = useMemo(() => {
    let agents = registry
    if (registryFilter === 'installed') {
      agents = agents.filter(a => installedMap.has(a.id))
    }
    if (query.trim()) {
      const q = query.toLowerCase()
      agents = agents.filter(
        a => a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q) || a.description.toLowerCase().includes(q),
      )
    }
    return agents
  }, [registry, query, registryFilter, installedMap])

  const handleInstall = useCallback(async (agentId: string, distType: 'binary' | 'npx' | 'uvx') => {
    if (!ipc) {
      return
    }
    setBusyAgent(agentId)
    try {
      await ipc.acp.install(agentId, distType)
      // Refresh profiles too — install auto-creates a profile
      await Promise.all([refreshInstalled(), refreshProfiles()])
    }
    catch { /* error tracked in DB */ }
    finally {
      setBusyAgent(null)
    }
  }, [refreshInstalled, refreshProfiles])

  const handleCancelInstall = useCallback(async (agentId: string) => {
    if (!ipc) {
      return
    }
    try {
      await ipc.acp.cancelInstall(agentId)
    }
    catch { /* noop */ }
    finally {
      await Promise.all([refreshInstalled(), refreshProfiles()])
    }
  }, [refreshInstalled, refreshProfiles])

  const handleUninstall = useCallback(async (agentId: string) => {
    if (!ipc) {
      return
    }
    setBusyAgent(agentId)
    try {
      await ipc.acp.uninstall(agentId)
      await Promise.all([refreshInstalled(), refreshProfiles()])
    }
    catch { /* noop */ }
    finally {
      setBusyAgent(null)
    }
  }, [refreshInstalled, refreshProfiles])

  const handleAddProfile = useCallback(async () => {
    if (!ipc) {
      return
    }
    setAddStatus(null)
    setBusyAdd(true)
    try {
      let credentialRef: string | null = null
      if (form.kind === 'openai-compatible' && form.fields.apiKey) {
        const meta = await ipc.agentRuntime.saveCredential({
          providerKind: 'openai-compatible',
          label: form.fields.name,
          secret: form.fields.apiKey,
        })
        credentialRef = meta.id
      }

      const profileId = buildProfileId(form.fields.name, form.kind)
      await ipc.agentRuntime.upsertProfile({
        id: profileId,
        name: form.fields.name,
        providerKind: form.kind,
        enabled: true,
        configJson: buildConfigJson(form),
        credentialRef,
      })

      try {
        const result = await ipc.agentRuntime.probeProfile(profileId)
        setAddStatus({ ok: result.ok, text: result.ok ? `${result.label} is ready` : (result.errorText ?? 'Probe failed') })
      }
      catch {
        setAddStatus({ ok: false, text: 'Saved, but probe failed' })
      }

      await refreshProfiles()
      setAddingProfile(false)
      setForm(defaultFields('openai-compatible'))
    }
    catch {
      setAddStatus({ ok: false, text: 'Failed to save' })
    }
    finally {
      setBusyAdd(false)
    }
  }, [form, refreshProfiles])

  const handleRemoveProfile = useCallback(async (id: string) => {
    if (!ipc) {
      return
    }
    await ipc.agentRuntime.removeProfile(id)
    await refreshProfiles()
  }, [refreshProfiles])

  const handleToggleProfile = useCallback(async (id: string, enabled: boolean) => {
    if (!ipc) {
      return
    }
    const profile = profiles.find(p => p.id === id)
    if (!profile) {
      return
    }
    await ipc.agentRuntime.upsertProfile({ ...profile, enabled })
    await refreshProfiles()
  }, [profiles, refreshProfiles])

  // Audit sub-view
  if (subView.view === 'audit') {
    return (
      <AuditLogView
        agentId={subView.agentId}
        onBack={() => { setSubView({ view: 'main' }) }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-7" data-testid="agents-settings">
      {/* Page header */}
      <div>
        <h3 className="text-base font-semibold tracking-tight">Agents</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Install agents from the registry or add custom providers. Installed agents are automatically available in chat.
        </p>
      </div>

      {/* We build a simple tab system without the Tabs primitive to avoid complexity */}
      <SimpleTabs
        tabs={[
          {
            id: 'registry',
            label: 'Registry',
            content: (
              <RegistryTab
                registry={filteredRegistry}
                installed={installed}
                installedMap={installedMap}
                loading={registryLoading}
                error={registryError}
                query={query}
                onQueryChange={setQuery}
                filter={registryFilter}
                onFilterChange={setRegistryFilter}
                onRefresh={refreshRegistry}
                busyAgent={busyAgent}
                onInstall={(id, type) => { handleInstall(id, type) }}
                onUninstall={(id) => { handleUninstall(id) }}
                onCancelInstall={(id) => { handleCancelInstall(id) }}
                onAudit={(id) => { setSubView({ view: 'audit', agentId: id }) }}
                onAuditAll={() => { setSubView({ view: 'audit', agentId: '' }) }}
              />
            ),
          },
          {
            id: 'configured',
            label: `Configured (${profiles.length})`,
            content: (
              <ConfiguredTab
                profiles={profiles}
                addingProfile={addingProfile}
                form={form}
                busyAdd={busyAdd}
                addStatus={addStatus}
                onSetAddingProfile={setAddingProfile}
                onSetForm={setForm}
                onAddProfile={handleAddProfile}
                onRemoveProfile={handleRemoveProfile}
                onToggleProfile={handleToggleProfile}
              />
            ),
          },
        ]}
      />
    </div>
  )
}

// ── Simple tab switcher ───────────────────────────────────────────────────────

interface SimpleTab {
  id: string
  label: string
  content: React.ReactNode
}

function SimpleTabs({ tabs }: { tabs: SimpleTab[] }) {
  const [active, setActive] = useState(tabs[0].id)
  const activeTab = tabs.find(t => t.id === active) ?? tabs[0]

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-0.5 rounded-lg border bg-muted/50 p-0.5 w-fit">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => { setActive(tab.id) }}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-all',
              active === tab.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab.content}
    </div>
  )
}

// ── Registry tab ──────────────────────────────────────────────────────────────

interface RegistryTabProps {
  registry: RegistryAgent[]
  installed: AcpAgent[]
  installedMap: Map<string, AcpAgent>
  loading: boolean
  error: string | null
  query: string
  onQueryChange: (q: string) => void
  filter: 'all' | 'installed'
  onFilterChange: (f: 'all' | 'installed') => void
  onRefresh: () => void
  busyAgent: string | null
  onInstall: (id: string, type: 'binary' | 'npx' | 'uvx') => void
  onUninstall: (id: string) => void
  onCancelInstall: (id: string) => void
  onAudit: (id: string) => void
  onAuditAll: () => void
}

function RegistryTab({
  registry,
  installed,
  installedMap,
  loading,
  error,
  query,
  onQueryChange,
  filter,
  onFilterChange,
  onRefresh,
  busyAgent,
  onInstall,
  onUninstall,
  onCancelInstall,
  onAudit,
  onAuditAll,
}: RegistryTabProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => { onQueryChange(e.target.value) }}
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
              onClick={() => { onFilterChange(f) }}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium transition-all',
                filter === f ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f === 'all' ? 'All' : `Installed (${installed.length})`}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="icon-xs" onClick={onRefresh} disabled={loading}>
          <RotateCwIcon className={cn('size-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      {/* Content */}
      {loading
        ? <div className="flex justify-center py-16"><Spinner className="size-5 text-muted-foreground" /></div>
        : error
          ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <XCircleIcon className="size-6 text-destructive" />
              <p className="max-w-xs text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" size="xs" onClick={onRefresh}>Retry</Button>
            </div>
          )
          : registry.length === 0
            ? (
              <div className="flex flex-col items-center gap-2 py-16 text-center">
                <PackageIcon className="size-6 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {query ? 'No agents match your search' : 'Registry is empty'}
                </p>
              </div>
            )
            : (
              <div className="grid gap-3 sm:grid-cols-2" data-testid="acp-agent-list">
                {registry.map(agent => (
                  <RegistryAgentCard
                    key={agent.id}
                    agent={agent}
                    record={installedMap.get(agent.id)}
                    onInstall={(type) => { onInstall(agent.id, type) }}
                    onUninstall={() => { onUninstall(agent.id) }}
                    onCancelInstall={() => { onCancelInstall(agent.id) }}
                    onAudit={() => { onAudit(agent.id) }}
                    busy={busyAgent === agent.id}
                  />
                ))}
              </div>
            )}

      {!loading && installed.length > 0 && (
        <>
          <Separator />
          <button
            type="button"
            onClick={onAuditAll}
            className="flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <FileTextIcon className="size-3.5" />
            View all install logs
          </button>
        </>
      )}
    </div>
  )
}

// ── Configured tab ────────────────────────────────────────────────────────────

interface ConfiguredTabProps {
  profiles: AgentProfile[]
  addingProfile: boolean
  form: ProviderFields
  busyAdd: boolean
  addStatus: { ok: boolean, text: string } | null
  onSetAddingProfile: (v: boolean) => void
  onSetForm: (f: ProviderFields) => void
  onAddProfile: () => void
  onRemoveProfile: (id: string) => void
  onToggleProfile: (id: string, enabled: boolean) => void
}

function ConfiguredTab({
  profiles,
  addingProfile,
  form,
  busyAdd,
  addStatus,
  onSetAddingProfile,
  onSetForm,
  onAddProfile,
  onRemoveProfile,
  onToggleProfile,
}: ConfiguredTabProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* Add button / collapse form */}
      {!addingProfile
        ? (
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => { onSetAddingProfile(true) }}
          >
            <PlusIcon className="size-3.5" />
            Add provider
          </Button>
        )
        : (
          <div className="rounded-xl border bg-card p-4">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-medium">New provider</span>
              <button
                type="button"
                onClick={() => { onSetAddingProfile(false) }}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Cancel
              </button>
            </div>
            <ProfileForm form={form} setForm={onSetForm} />
            {addStatus && (
              <p className={cn('mt-3 text-xs', addStatus.ok ? 'text-green-600 dark:text-green-400' : 'text-destructive')}>
                {addStatus.text}
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <Button size="sm" onClick={onAddProfile} disabled={busyAdd}>
                {busyAdd && <Spinner className="size-3" />}
                <PlusIcon className="size-3" />
                Add
              </Button>
            </div>
          </div>
        )}

      {/* Profile list */}
      {profiles.length === 0
        ? (
          <div className="rounded-xl border border-dashed px-4 py-10 text-center">
            <BotIcon className="mx-auto mb-2 size-6 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No configured providers yet.</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Install from the Registry tab or add a custom provider above.</p>
          </div>
        )
        : (
          <div className="flex flex-col gap-2" data-testid="agent-profile-list">
            {profiles.map(profile => (
              <ProfileRow
                key={profile.id}
                profile={profile}
                onRemove={() => { onRemoveProfile(profile.id) }}
                onToggle={() => { onToggleProfile(profile.id, !profile.enabled) }}
              />
            ))}
          </div>
        )}
    </div>
  )
}
