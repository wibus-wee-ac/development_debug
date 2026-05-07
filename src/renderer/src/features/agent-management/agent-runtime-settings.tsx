// Input: ipc.agentRuntime profile and credential methods, coss UI primitives, SettingsRow
// Output: AgentRuntimeSettings component — Linear-style provider management
// Position: Settings feature section for Agent Runtime provider configuration

import type { AgentProfile, ModelDescriptor, ProviderKind } from '@main/ipc-types'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Spinner } from '@renderer/components/ui/spinner'
import { Switch } from '@renderer/components/ui/switch'
import { cn } from '@renderer/lib/cn'
import { ipc } from '@renderer/lib/ipc'
import { CheckCircleIcon, PlusIcon, TrashIcon, XCircleIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { SettingsDivider, SettingsRow, SettingsSectionHeader } from '../settings/settings-row'

// ── Provider metadata ─────────────────────────────────────────────────────────

const PROVIDER_KINDS: Array<{ id: ProviderKind, label: string, description: string }> = [
  { id: 'openai-compatible', label: 'OpenAI-compatible', description: 'Any OpenAI API compatible endpoint' },
  { id: 'acp-chat', label: 'ACP Chat', description: 'Local Agent Communication Protocol' },
  { id: 'cli-tui', label: 'CLI TUI', description: 'Command-line agent interface' },
  { id: 'codex', label: 'Codex', description: 'OpenAI Codex App Server' },
  { id: 'claude-agent', label: 'Claude Agent', description: 'Claude Agent SDK (Anthropic)' },
]

const DEFAULT_NAMES: Record<ProviderKind, string> = {
  'openai-compatible': 'OpenAI-compatible',
  'acp-chat': 'Local ACP',
  'cli-tui': 'Local CLI',
  'codex': 'Codex',
  'claude-agent': 'Claude Agent',
}

const WHITESPACE_RE = /\s+/g

function buildProfileId(name: string, kind: ProviderKind): string {
  const base = name.trim().toLowerCase().replace(WHITESPACE_RE, '-')
  return base || kind
}

// ── Per-provider form state ───────────────────────────────────────────────────

interface OpenAIFields { name: string, baseUrl: string, model: string, apiKey: string }
interface AcpFields { name: string, packageName: string, distributionType: 'npx' | 'global' }
interface CliTuiFields { name: string, command: string }
interface CodexFields { name: string, baseUrl: string, model: string, apiKey: string }
interface ClaudeAgentFields { name: string, baseUrl: string, model: string, apiKey: string }

type ProviderFields
  = { kind: 'openai-compatible', fields: OpenAIFields }
  | { kind: 'acp-chat', fields: AcpFields }
  | { kind: 'cli-tui', fields: CliTuiFields }
  | { kind: 'codex', fields: CodexFields }
  | { kind: 'claude-agent', fields: ClaudeAgentFields }

function defaultFields(kind: ProviderKind): ProviderFields {
  switch (kind) {
    case 'openai-compatible': return { kind, fields: { name: DEFAULT_NAMES[kind], baseUrl: 'https://api.openai.com/v1', model: '', apiKey: '' } }
    case 'acp-chat': return { kind, fields: { name: DEFAULT_NAMES[kind], packageName: '', distributionType: 'npx' } }
    case 'cli-tui': return { kind, fields: { name: DEFAULT_NAMES[kind], command: 'claude' } }
    case 'codex': return { kind, fields: { name: DEFAULT_NAMES[kind], baseUrl: 'https://api.openai.com/v1', model: 'codex-mini-latest', apiKey: '' } }
    case 'claude-agent': return { kind, fields: { name: DEFAULT_NAMES[kind], baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-20250514', apiKey: '' } }
  }
}

function buildConfigJson(pf: ProviderFields): string {
  switch (pf.kind) {
    case 'openai-compatible': return JSON.stringify({ baseUrl: pf.fields.baseUrl, model: pf.fields.model || undefined })
    case 'acp-chat': return JSON.stringify({ distributionType: pf.fields.distributionType, cmd: pf.fields.packageName, args: [] })
    case 'cli-tui': return JSON.stringify({ executable: pf.fields.command, args: [] })
    case 'codex': return JSON.stringify({ baseUrl: pf.fields.baseUrl, model: pf.fields.model || undefined })
    case 'claude-agent': return JSON.stringify({ baseUrl: pf.fields.baseUrl, model: pf.fields.model || undefined })
  }
}

// ── Add Provider Dialog ───────────────────────────────────────────────────────

function AddProviderDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: () => void
}) {
  const [form, setForm] = useState<ProviderFields>(() => defaultFields('openai-compatible'))
  const [busy, setBusy] = useState(false)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [statusOk, setStatusOk] = useState<boolean | null>(null)

  const profileId = useMemo(() => buildProfileId(form.fields.name, form.kind), [form])

  const handleProviderChange = useCallback((value: string) => {
    const nextKind = value as ProviderKind
    setForm(defaultFields(nextKind))
    setStatusText(null)
    setStatusOk(null)
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!ipc) {
      return
    }
    setBusy(true)
    setStatusText(null)
    setStatusOk(null)
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
      else if (form.kind === 'codex' && form.fields.apiKey) {
        const meta = await ipc.agentRuntime.saveCredential({
          providerKind: 'codex',
          label: form.fields.name,
          secret: form.fields.apiKey,
        })
        credentialRef = meta.id
      }
      else if (form.kind === 'claude-agent' && form.fields.apiKey) {
        const meta = await ipc.agentRuntime.saveCredential({
          providerKind: 'claude-agent',
          label: form.fields.name,
          secret: form.fields.apiKey,
        })
        credentialRef = meta.id
      }

      await ipc.agentRuntime.upsertProfile({
        id: profileId,
        name: form.fields.name,
        providerKind: form.kind,
        enabled: true,
        configJson: buildConfigJson(form),
        credentialRef,
      })

      let shouldClose = false
      try {
        const result = await ipc.agentRuntime.probeProfile(profileId)
        setStatusOk(result.ok)
        setStatusText(result.ok ? `${result.label} ready` : (result.errorText ?? 'Probe failed'))
        shouldClose = result.ok
      }
      catch {
        setStatusOk(false)
        setStatusText('Saved, but probe failed')
      }

      onAdded()
      if (shouldClose) {
        onOpenChange(false)
        setForm(defaultFields('openai-compatible'))
      }
    }
    catch (err) {
      setStatusOk(false)
      setStatusText('Failed to save')
      console.error('[AgentRuntimeSettings]', err)
    }
    finally {
      setBusy(false)
    }
  }, [form, profileId, onAdded, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>Add Provider</DialogTitle>
          <DialogDescription>
            Configure a new AI provider profile for use in sessions.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Provider type selector */}
          <div className="grid gap-1.5">
            <Label>Provider Type</Label>
            <Select value={form.kind} onValueChange={handleProviderChange}>
              <SelectTrigger data-testid="agent-provider-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_KINDS.map(kind => (
                  <SelectItem key={kind.id} value={kind.id}>{kind.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Provider-specific fields */}
          {form.kind === 'openai-compatible' && (
            <>
              <div className="grid gap-1.5">
                <Label>Name</Label>
                <Input data-testid="provider-name" value={form.fields.name} onChange={e => setForm({ ...form, fields: { ...form.fields, name: e.target.value } })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Base URL</Label>
                <Input data-testid="provider-baseurl" value={form.fields.baseUrl} onChange={e => setForm({ ...form, fields: { ...form.fields, baseUrl: e.target.value } })} placeholder="https://api.openai.com/v1" />
              </div>
              <div className="grid gap-1.5">
                <Label>Default Model</Label>
                <Input data-testid="provider-model" value={form.fields.model} onChange={e => setForm({ ...form, fields: { ...form.fields, model: e.target.value } })} placeholder="gpt-4o (fallback if /models unavailable)" />
              </div>
              <div className="grid gap-1.5">
                <Label>API Key</Label>
                <Input data-testid="provider-apikey" type="password" value={form.fields.apiKey} onChange={e => setForm({ ...form, fields: { ...form.fields, apiKey: e.target.value } })} placeholder="sk-..." />
              </div>
            </>
          )}

          {form.kind === 'acp-chat' && (
            <>
              <div className="grid gap-1.5">
                <Label>Name</Label>
                <Input value={form.fields.name} onChange={e => setForm({ ...form, fields: { ...form.fields, name: e.target.value } })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Distribution</Label>
                <Select value={form.fields.distributionType} onValueChange={v => setForm({ ...form, fields: { ...form.fields, distributionType: v as 'npx' | 'global' } })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="npx">npx</SelectItem>
                    <SelectItem value="global">Global install</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Package / Command</Label>
                <Input value={form.fields.packageName} onChange={e => setForm({ ...form, fields: { ...form.fields, packageName: e.target.value } })} placeholder="@anthropic/claude-code" />
              </div>
            </>
          )}

          {form.kind === 'cli-tui' && (
            <>
              <div className="grid gap-1.5">
                <Label>Name</Label>
                <Input value={form.fields.name} onChange={e => setForm({ ...form, fields: { ...form.fields, name: e.target.value } })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Command</Label>
                <Input value={form.fields.command} onChange={e => setForm({ ...form, fields: { ...form.fields, command: e.target.value } })} placeholder="claude" />
              </div>
            </>
          )}

          {form.kind === 'codex' && (
            <>
              <div className="grid gap-1.5">
                <Label>Name</Label>
                <Input data-testid="provider-name" value={form.fields.name} onChange={e => setForm({ ...form, fields: { ...form.fields, name: e.target.value } })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Base URL</Label>
                <Input data-testid="provider-baseurl" value={form.fields.baseUrl} onChange={e => setForm({ ...form, fields: { ...form.fields, baseUrl: e.target.value } })} placeholder="https://api.openai.com/v1" />
              </div>
              <div className="grid gap-1.5">
                <Label>Model</Label>
                <Input data-testid="provider-model" value={form.fields.model} onChange={e => setForm({ ...form, fields: { ...form.fields, model: e.target.value } })} placeholder="codex-mini-latest" />
              </div>
              <div className="grid gap-1.5">
                <Label>API Key</Label>
                <Input data-testid="provider-apikey" type="password" value={form.fields.apiKey} onChange={e => setForm({ ...form, fields: { ...form.fields, apiKey: e.target.value } })} placeholder="sk-..." />
              </div>
            </>
          )}

          {form.kind === 'claude-agent' && (
            <>
              <div className="grid gap-1.5">
                <Label>Name</Label>
                <Input data-testid="provider-name" value={form.fields.name} onChange={e => setForm({ ...form, fields: { ...form.fields, name: e.target.value } })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Base URL</Label>
                <Input data-testid="provider-baseurl" value={form.fields.baseUrl} onChange={e => setForm({ ...form, fields: { ...form.fields, baseUrl: e.target.value } })} placeholder="https://api.anthropic.com/v1" />
              </div>
              <div className="grid gap-1.5">
                <Label>Model</Label>
                <Input data-testid="provider-model" value={form.fields.model} onChange={e => setForm({ ...form, fields: { ...form.fields, model: e.target.value } })} placeholder="claude-sonnet-4-20250514" />
              </div>
              <div className="grid gap-1.5">
                <Label>API Key</Label>
                <Input data-testid="provider-apikey" type="password" value={form.fields.apiKey} onChange={e => setForm({ ...form, fields: { ...form.fields, apiKey: e.target.value } })} placeholder="sk-ant-..." />
              </div>
            </>
          )}

          {/* Status message */}
          {statusText && (
            <div
              data-testid="provider-status"
              data-status-ok={statusOk ? 'true' : 'false'}
              className={cn(
                'flex items-center gap-2 text-[12px]',
                statusOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive',
              )}
            >
              {statusOk ? <CheckCircleIcon className="size-3.5" /> : <XCircleIcon className="size-3.5" />}
              {statusText}
            </div>
          )}
        </div>

        <DialogFooter variant="bare">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button data-testid="provider-submit" size="sm" onClick={() => void handleSubmit()} disabled={busy}>
            {busy && <Spinner className="size-3.5" />}
            Add Provider
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Shared Available Models field ─────────────────────────────────────────────

// Sentinel stored in enabledModels state to represent "all models disabled"
const ALL_DISABLED_SENTINEL = '__all_disabled__'

function AvailableModelsField({
  loading,
  models,
  enabledModels,
  onToggle,
  onShowAll,
  onDisableAll,
}: {
  loading: boolean
  models: ModelDescriptor[]
  enabledModels: string[]
  onToggle: (id: string, checked: boolean) => void
  onShowAll: () => void
  onDisableAll: () => void
}) {
  const [filter, setFilter] = useState('')
  const allDisabled = enabledModels.length === 1 && enabledModels[0] === ALL_DISABLED_SENTINEL
  const visible = filter.trim()
    ? models.filter(m => (m.label || m.id).toLowerCase().includes(filter.toLowerCase()))
    : models

  function isChecked(id: string) {
    if (allDisabled) return false
    return enabledModels.length === 0 || enabledModels.includes(id)
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <Label>Available Models</Label>
        <div className="flex items-center gap-1">
          {(enabledModels.length > 0) && (
            <Button type="button" variant="ghost" size="sm" onClick={onShowAll} className="h-auto py-0 text-[11px] text-muted-foreground">
              Show all
            </Button>
          )}
          {!allDisabled && (
            <Button type="button" variant="ghost" size="sm" onClick={onDisableAll} className="h-auto py-0 text-[11px] text-muted-foreground">
              Disable all
            </Button>
          )}
        </div>
      </div>
      {loading
        ? (
          <div className="flex items-center gap-2 py-2 text-[12px] text-muted-foreground">
            <Spinner className="size-3" />
            Fetching models…
          </div>
        )
        : models.length === 0
          ? (
            <p className="text-[12px] text-muted-foreground py-1">
              No models returned from API. Save first if you changed the base URL or API key.
            </p>
          )
          : (
            <>
              <Input
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder="Filter models…"
                className="h-7 text-[12px]"
              />
              <div className="max-h-40 overflow-y-auto rounded-md border border-border/40 divide-y divide-border/20">
                {visible.map(m => (
                  <label
                    key={m.id}
                    className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-accent/40 transition-colors"
                  >
                    <Checkbox
                      checked={isChecked(m.id)}
                      onCheckedChange={checked => onToggle(m.id, !!checked)}
                    />
                    <span className="text-[12px] truncate">{m.label || m.id}</span>
                    {m.contextWindow && (
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60">
                        {(m.contextWindow / 1000).toFixed(0)}k
                      </span>
                    )}
                  </label>
                ))}
                {visible.length === 0 && (
                  <p className="px-3 py-2 text-[12px] text-muted-foreground">No matching models.</p>
                )}
              </div>
            </>
          )}
      <p className="text-[11px] text-muted-foreground/60">
        {allDisabled
          ? 'No models enabled'
          : enabledModels.length === 0
            ? 'All models shown in chat'
            : `${enabledModels.length} model${enabledModels.length === 1 ? '' : 's'} enabled`}
      </p>
    </div>
  )
}

// ── Edit Provider Dialog ───────────────────────────────────────────────────────

function EditProviderDialog({
  open,
  onOpenChange,
  profile,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  profile: AgentProfile
  onSaved: () => void
}) {
  const parsed = useMemo(() => {
    try {
      return JSON.parse(profile.configJson ?? '{}')
    }
    catch {
      return {}
    }
  }, [profile.configJson])

  const [name, setName] = useState(profile.name)
  const [enabled, setEnabled] = useState(profile.enabled)
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(parsed.baseUrl ?? '')
  const [model, setModel] = useState(parsed.model ?? '')
  const [enabledModels, setEnabledModels] = useState<string[]>(
    !Array.isArray(parsed.enabledModels)
      ? []
      : parsed.enabledModels.length === 0
        ? [ALL_DISABLED_SENTINEL]
        : parsed.enabledModels,
  )
  const [command, setCommand] = useState(parsed.executable ?? parsed.cmd ?? '')
  const [busy, setBusy] = useState(false)
  const [availableModels, setAvailableModels] = useState<ModelDescriptor[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)

  useEffect(() => {
    setName(profile.name)
    setEnabled(profile.enabled)
    setApiKey('')
    setBaseUrl(parsed.baseUrl ?? '')
    setModel(parsed.model ?? '')
    setEnabledModels(
      !Array.isArray(parsed.enabledModels)
        ? []
        : parsed.enabledModels.length === 0
          ? [ALL_DISABLED_SENTINEL]
          : parsed.enabledModels,
    )
    setCommand(parsed.executable ?? parsed.cmd ?? '')
  }, [profile, parsed])

  // Auto-fetch available models when dialog opens for providers that support it
  useEffect(() => {
    const supportsModels = profile.providerKind === 'openai-compatible'
      || profile.providerKind === 'codex'
      || profile.providerKind === 'claude-agent'
    if (!open || !supportsModels || !ipc) {
      return
    }
    setModelsLoading(true)
    ipc.agentRuntime.listModels(profile.id)
      .then((models) => {
        setAvailableModels(models as ModelDescriptor[])
      })
      .catch(() => {
        setAvailableModels([])
      })
      .finally(() => {
        setModelsLoading(false)
      })
  }, [open, profile.id, profile.providerKind])

  const handleSave = useCallback(async () => {
    if (!ipc) {
      return
    }
    setBusy(true)
    try {
      let credentialRef = profile.credentialRef ?? null
      if (profile.providerKind === 'openai-compatible' && apiKey) {
        const meta = await ipc.agentRuntime.saveCredential({
          providerKind: 'openai-compatible',
          label: name,
          secret: apiKey,
        })
        credentialRef = meta.id
      }
      else if (profile.providerKind === 'codex' && apiKey) {
        const meta = await ipc.agentRuntime.saveCredential({
          providerKind: 'codex',
          label: name,
          secret: apiKey,
        })
        credentialRef = meta.id
      }
      else if (profile.providerKind === 'claude-agent' && apiKey) {
        const meta = await ipc.agentRuntime.saveCredential({
          providerKind: 'claude-agent',
          label: name,
          secret: apiKey,
        })
        credentialRef = meta.id
      }

      let configJson = profile.configJson
      if (profile.providerKind === 'openai-compatible') {
        const cleanEnabled = enabledModels.filter(id => id !== ALL_DISABLED_SENTINEL)
        configJson = JSON.stringify({ baseUrl, model: model || undefined, enabledModels: cleanEnabled.length > 0 ? cleanEnabled : enabledModels[0] === ALL_DISABLED_SENTINEL ? [] : undefined })
      }
      else if (profile.providerKind === 'codex') {
        const cleanEnabled = enabledModels.filter(id => id !== ALL_DISABLED_SENTINEL)
        configJson = JSON.stringify({ baseUrl, model: model || undefined, enabledModels: cleanEnabled.length > 0 ? cleanEnabled : enabledModels[0] === ALL_DISABLED_SENTINEL ? [] : undefined })
      }
      else if (profile.providerKind === 'claude-agent') {
        const cleanEnabled = enabledModels.filter(id => id !== ALL_DISABLED_SENTINEL)
        configJson = JSON.stringify({ baseUrl, model: model || undefined, enabledModels: cleanEnabled.length > 0 ? cleanEnabled : enabledModels[0] === ALL_DISABLED_SENTINEL ? [] : undefined })
      }
      else if (profile.providerKind === 'cli-tui') {
        configJson = JSON.stringify({ executable: command, args: [] })
      }
      else if (profile.providerKind === 'acp-chat') {
        configJson = JSON.stringify({ ...parsed, cmd: command })
      }

      await ipc.agentRuntime.upsertProfile({
        id: profile.id,
        name,
        providerKind: profile.providerKind,
        enabled,
        configJson,
        credentialRef,
      })
      onSaved()
      onOpenChange(false)
    }
    catch (err) {
      console.error('[EditProvider]', err)
    }
    finally {
      setBusy(false)
    }
  }, [profile, name, enabled, apiKey, baseUrl, model, enabledModels, command, parsed, onSaved, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton data-testid="provider-edit-dialog">
        <DialogHeader>
          <DialogTitle>Edit Provider</DialogTitle>
          <DialogDescription>Modify provider configuration.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input data-testid="provider-edit-name" value={name} onChange={e => setName(e.target.value)} />
          </div>

          {profile.providerKind === 'openai-compatible' && (
            <>
              <div className="grid gap-1.5">
                <Label>Base URL</Label>
                <Input data-testid="provider-edit-baseurl" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>API Key (leave empty to keep current)</Label>
                <Input data-testid="provider-edit-apikey" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." />
              </div>
              <div className="grid gap-1.5">
                <Label>Default Model</Label>
                <Input
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  placeholder="e.g. gpt-4o (fallback if /models fails)"
                />
              </div>
              <AvailableModelsField
                loading={modelsLoading}
                models={availableModels}
                enabledModels={enabledModels}
                onToggle={(id, checked) => {
                  if (checked) {
                    setEnabledModels(prev => {
                      const base = prev[0] === ALL_DISABLED_SENTINEL || prev.length === 0 ? availableModels.map(x => x.id) : prev
                      return [...base.filter(x => x !== id), id]
                    })
                  }
                  else {
                    setEnabledModels(prev => {
                      const base = prev[0] === ALL_DISABLED_SENTINEL ? [] : prev.length === 0 ? availableModels.map(x => x.id) : prev
                      return base.filter(x => x !== id)
                    })
                  }
                }}
                onShowAll={() => setEnabledModels([])}
                onDisableAll={() => setEnabledModels([ALL_DISABLED_SENTINEL])}
              />
            </>
          )}

          {profile.providerKind === 'codex' && (
            <>
              <div className="grid gap-1.5">
                <Label>Base URL</Label>
                <Input data-testid="provider-edit-baseurl" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
              </div>
              <div className="grid gap-1.5">
                <Label>Model</Label>
                <Input value={model} onChange={e => setModel(e.target.value)} placeholder="codex-mini-latest" />
              </div>
              <div className="grid gap-1.5">
                <Label>API Key (leave empty to keep current)</Label>
                <Input data-testid="provider-edit-apikey" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." />
              </div>
              <AvailableModelsField
                loading={modelsLoading}
                models={availableModels}
                enabledModels={enabledModels}
                onToggle={(id, checked) => {
                  if (checked) {
                    setEnabledModels(prev => {
                      const base = prev[0] === ALL_DISABLED_SENTINEL || prev.length === 0 ? availableModels.map(x => x.id) : prev
                      return [...base.filter(x => x !== id), id]
                    })
                  }
                  else {
                    setEnabledModels(prev => {
                      const base = prev[0] === ALL_DISABLED_SENTINEL ? [] : prev.length === 0 ? availableModels.map(x => x.id) : prev
                      return base.filter(x => x !== id)
                    })
                  }
                }}
                onShowAll={() => setEnabledModels([])}
                onDisableAll={() => setEnabledModels([ALL_DISABLED_SENTINEL])}
              />
            </>
          )}

          {profile.providerKind === 'claude-agent' && (
            <>
              <div className="grid gap-1.5">
                <Label>Base URL</Label>
                <Input data-testid="provider-edit-baseurl" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.anthropic.com/v1" />
              </div>
              <div className="grid gap-1.5">
                <Label>Model</Label>
                <Input value={model} onChange={e => setModel(e.target.value)} placeholder="claude-sonnet-4-20250514" />
              </div>
              <div className="grid gap-1.5">
                <Label>API Key (leave empty to keep current)</Label>
                <Input data-testid="provider-edit-apikey" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-ant-..." />
              </div>
              <AvailableModelsField
                loading={modelsLoading}
                models={availableModels}
                enabledModels={enabledModels}
                onToggle={(id, checked) => {
                  if (checked) {
                    setEnabledModels(prev => {
                      const base = prev[0] === ALL_DISABLED_SENTINEL || prev.length === 0 ? availableModels.map(x => x.id) : prev
                      return [...base.filter(x => x !== id), id]
                    })
                  }
                  else {
                    setEnabledModels(prev => {
                      const base = prev[0] === ALL_DISABLED_SENTINEL ? [] : prev.length === 0 ? availableModels.map(x => x.id) : prev
                      return base.filter(x => x !== id)
                    })
                  }
                }}
                onShowAll={() => setEnabledModels([])}
                onDisableAll={() => setEnabledModels([ALL_DISABLED_SENTINEL])}
              />
            </>
          )}

          {(profile.providerKind === 'cli-tui' || profile.providerKind === 'acp-chat') && (
            <div className="grid gap-1.5">
              <Label>Command</Label>
              <Input value={command} onChange={e => setCommand(e.target.value)} />
            </div>
          )}

          <div className="flex items-center gap-2">
            <Label>Enabled</Label>
            <button
              type="button"
              onClick={() => setEnabled(!enabled)}
              data-testid="provider-edit-enabled"
              className={cn(
                'text-[11px] px-2 py-0.5 rounded-md font-medium transition-colors',
                enabled
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-foreground/5 text-muted-foreground',
              )}
            >
              {enabled ? 'Active' : 'Disabled'}
            </button>
          </div>
        </div>
        <DialogFooter variant="bare">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={busy} data-testid="provider-edit-save">
            {busy && <Spinner className="size-3.5" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Provider Card ─────────────────────────────────────────────────────────────

function ProviderCard({
  profile,
  onRemove,
  onEdit,
  onToggle,
}: {
  profile: AgentProfile
  onRemove: () => void
  onEdit: () => void
  onToggle: (enabled: boolean) => void
}) {
  const kind = PROVIDER_KINDS.find(k => k.id === profile.providerKind)
  const parsed = useMemo(() => {
    try {
      return JSON.parse(profile.configJson ?? '{}')
    }
    catch {
      return {}
    }
  }, [profile.configJson])

  const detail = profile.providerKind === 'openai-compatible'
    ? parsed.model
    : (parsed.executable ?? parsed.cmd ?? '')

  const subtitle = [kind?.label ?? profile.providerKind, detail].filter(Boolean).join(' · ')

  return (
    <div data-testid={`agent-profile-row-${profile.id}`}>
      <SettingsRow
        label={profile.name}
        description={subtitle}
        className="group cursor-pointer rounded-lg -mx-3 px-3 hover:bg-accent"
        onClick={onEdit}
      >
        <div className="flex items-center gap-3" onClick={e => e.stopPropagation()}>
          <Switch
            size="sm"
            checked={profile.enabled}
            onCheckedChange={onToggle}
            data-testid={`agent-profile-toggle-${profile.id}`}
          />
          <button
            type="button"
            onClick={onRemove}
            className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
            data-testid={`agent-profile-remove-${profile.id}`}
          >
            <TrashIcon className="size-3.5" />
          </button>
        </div>
      </SettingsRow>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function AgentRuntimeSettings() {
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<AgentProfile | null>(null)

  const refreshProfiles = useCallback(async () => {
    if (!ipc) {
      return
    }
    setProfiles(await ipc.agentRuntime.listProfiles() as AgentProfile[])
  }, [])

  useEffect(() => {
    refreshProfiles().catch(() => setProfiles([]))
  }, [refreshProfiles])

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

  return (
    <div className="flex flex-col gap-1" data-testid="agent-runtime-settings">
      <SettingsSectionHeader
        title="Providers"
        description="Configure AI provider profiles for use in sessions."
        action={(
          <Button data-testid="add-provider-btn" size="sm" onClick={() => setDialogOpen(true)}>
            <PlusIcon className="size-3.5" />
            Add
          </Button>
        )}
      />

      <SettingsDivider />

      {/* Provider cards */}
      {profiles.length === 0
        ? (
          <div className="py-8 text-center text-[12px] text-muted-foreground">
            No providers configured yet.
          </div>
        )
        : (
          <div className="flex flex-col">
            {profiles.map(profile => (
              <ProviderCard
                key={profile.id}
                profile={profile}
                onRemove={() => void handleRemoveProfile(profile.id)}
                onEdit={() => setEditingProfile(profile)}
                onToggle={enabled => void handleToggleProfile(profile.id, enabled)}
              />
            ))}
          </div>
        )}

      {/* Add dialog */}
      <AddProviderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onAdded={() => void refreshProfiles()}
      />

      {/* Edit dialog */}
      {editingProfile && (
        <EditProviderDialog
          open={!!editingProfile}
          onOpenChange={(open) => {
            if (!open) {
              setEditingProfile(null)
            }
          }}
          profile={editingProfile}
          onSaved={() => void refreshProfiles()}
        />
      )}
    </div>
  )
}
