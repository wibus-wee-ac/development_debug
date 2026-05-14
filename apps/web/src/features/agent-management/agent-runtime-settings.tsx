// Input: profiles SDK, secrets SDK, providers SDK, coss UI primitives, SettingsRow
// Output: AgentRuntimeSettings component — Linear-style provider management
// Position: Settings feature section for Agent Runtime provider configuration

import { CheckCircleIcon, ChevronRightIcon, PlusIcon, TrashIcon, XCircleIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  deleteProfilesById,
  getProfiles,
  postProvidersHealthCheck,
  postProvidersModels,
  postSecrets,
  putProfilesById,
} from '~/api-gen/sdk.gen'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { cn } from '~/lib/cn'
import type { AgentProfile, ModelDescriptor, ProviderKind } from '~/lib/types'

import { SettingsDivider, SettingsRow, SettingsSectionHeader } from '../settings/settings-row'
import { PROVIDER_ACCENT, PROVIDER_ICONS } from './provider-icons'
import type { ProviderPreset } from './provider-templates'
import { PROVIDER_PRESETS } from './provider-templates'

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

// eslint-disable-next-line unused-imports/no-unused-vars
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
    setBusy(true)
    setStatusText(null)
    setStatusOk(null)
    try {
      let credentialRef: string | null = null

      if ('apiKey' in form.fields && form.fields.apiKey) {
        const { data: meta } = await postSecrets({
          body: { kind: form.kind, label: form.fields.name, secret: form.fields.apiKey } as unknown as never,
        })
        credentialRef = (meta as any)?.id ?? null
      }

      await putProfilesById({
        path: { id: profileId },
        body: {
          name: form.fields.name,
          providerKind: form.kind,
          enabled: true,
          config: JSON.parse(buildConfigJson(form)),
          credentialRef,
        },
      })

      let shouldClose = false
      try {
        const config = (() => {
 try {
   return JSON.parse(buildConfigJson(form))
 }
 catch {
   return {}
 }
})()
        const { data: result } = await postProvidersHealthCheck({
          body: {
            providerKind: form.kind,
            label: form.fields.name,
            config,
            secretRef: credentialRef,
            profileId,
          },
        })
        const hcResult = result as { ok: boolean, label?: string, errorText?: string } | null
        setStatusOk(hcResult?.ok ?? false)
        setStatusText(hcResult?.ok ? `${hcResult.label ?? form.fields.name} ready` : (hcResult?.errorText ?? 'Health check failed'))
        shouldClose = hcResult?.ok ?? false
      }
      catch {
        setStatusOk(false)
        setStatusText('Saved, but health check failed')
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
    if (allDisabled) {
      return false
    }
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
                        {(m.contextWindow / 1000).toFixed(0)}
k
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

// ── Edit Provider Dialog (legacy — kept for tests) ────────────────────────────

// eslint-disable-next-line unused-imports/no-unused-vars
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
    if (!open || !supportsModels) {
      return
    }
    setModelsLoading(true)
    const config = (() => {
 try {
   return JSON.parse(profile.configJson)
 }
 catch {
   return {}
 }
})()
    postProvidersModels({
      body: {
        providerKind: profile.providerKind,
        label: profile.name,
        config,
        secretRef: profile.credentialRef ?? null,
        profileId: profile.id,
      },
    })
      .then(({ data }) => {
        setAvailableModels((data ?? []) as ModelDescriptor[])
      })
      .catch(() => {
        setAvailableModels([])
      })
      .finally(() => {
        setModelsLoading(false)
      })
  }, [open, profile.id, profile.providerKind, profile.configJson, profile.name, profile.credentialRef])

  const handleSave = useCallback(async () => {
    setBusy(true)
    try {
      let credentialRef = profile.credentialRef ?? null
      if (profile.providerKind === 'openai-compatible' && apiKey) {
        const { data: meta } = await postSecrets({
          body: { providerKind: 'openai-compatible', label: name, secret: apiKey } as unknown as never,
        })
        credentialRef = (meta as any)?.id ?? credentialRef
      }
      else if (profile.providerKind === 'codex' && apiKey) {
        const { data: meta } = await postSecrets({
          body: { providerKind: 'codex', label: name, secret: apiKey } as unknown as never,
        })
        credentialRef = (meta as any)?.id ?? credentialRef
      }
      else if (profile.providerKind === 'claude-agent' && apiKey) {
        const { data: meta } = await postSecrets({
          body: { providerKind: 'claude-agent', label: name, secret: apiKey } as unknown as never,
        })
        credentialRef = (meta as any)?.id ?? credentialRef
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

      await putProfilesById({
        path: { id: profile.id },
        body: {
          name,
          providerKind: profile.providerKind,
          enabled,
          config: JSON.parse(configJson),
          credentialRef,
        },
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
                  data-testid="provider-edit-model"
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
                    setEnabledModels((prev) => {
                      const base = prev[0] === ALL_DISABLED_SENTINEL || prev.length === 0 ? availableModels.map(x => x.id) : prev
                      return [...base.filter(x => x !== id), id]
                    })
                  }
                  else {
                    setEnabledModels((prev) => {
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
                <Input data-testid="provider-edit-model" value={model} onChange={e => setModel(e.target.value)} placeholder="codex-mini-latest" />
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
                    setEnabledModels((prev) => {
                      const base = prev[0] === ALL_DISABLED_SENTINEL || prev.length === 0 ? availableModels.map(x => x.id) : prev
                      return [...base.filter(x => x !== id), id]
                    })
                  }
                  else {
                    setEnabledModels((prev) => {
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
                <Input data-testid="provider-edit-model" value={model} onChange={e => setModel(e.target.value)} placeholder="claude-sonnet-4-20250514" />
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
                    setEnabledModels((prev) => {
                      const base = prev[0] === ALL_DISABLED_SENTINEL || prev.length === 0 ? availableModels.map(x => x.id) : prev
                      return [...base.filter(x => x !== id), id]
                    })
                  }
                  else {
                    setEnabledModels((prev) => {
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

// ── Main component — Master-Detail two-column layout ──────────────────────────

const RE_WHITESPACE = /\s+/g

// A "draft" represents a newly created provider not yet configured
interface DraftProvider {
  id: string
  presetId: string | null
}

export function AgentRuntimeSettings() {
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftProvider | null>(null)

  const refreshProfiles = useCallback(async () => {
    const { data } = await getProfiles()
    setProfiles((data ?? []) as AgentProfile[])
  }, [])

  useEffect(() => {
    refreshProfiles().catch(() => setProfiles([]))
  }, [refreshProfiles])

  const handleRemoveProfile = useCallback(async (id: string) => {
    await deleteProfilesById({ path: { id } })
    setSelectedId(null)
    await refreshProfiles()
  }, [refreshProfiles])

  const handleToggleProfile = useCallback(async (id: string, enabled: boolean) => {
    const profile = profiles.find(p => p.id === id)
    if (!profile) {
      return
    }
    await putProfilesById({
      path: { id },
      body: {
        name: profile.name,
        providerKind: profile.providerKind,
        enabled,
        config: (() => {
          try {
            return JSON.parse(profile.configJson)
          }
          catch {
            return {}
          }
        })(),
        credentialRef: profile.credentialRef ?? '',
      },
    })
    await refreshProfiles()
  }, [profiles, refreshProfiles])

  const handleAddDraft = useCallback(() => {
    const id = `draft-${Date.now()}`
    setDraft({ id, presetId: null })
    setSelectedId(id)
  }, [])

  const handleDraftComplete = useCallback(() => {
    setDraft(null)
    setSelectedId(null)
    void refreshProfiles()
  }, [refreshProfiles])

  const selectedProfile = profiles.find(p => p.id === selectedId) ?? null
  const isDraftSelected = draft && selectedId === draft.id

  return (
    <div className="flex flex-col gap-1" data-testid="agent-runtime-settings">
      <SettingsSectionHeader
        title="Providers"
        description="Configure AI provider profiles for use in sessions."
        action={(
          <Button data-testid="add-provider-btn" size="sm" onClick={handleAddDraft}>
            <PlusIcon className="size-3.5" />
            Add
          </Button>
        )}
      />
      <SettingsDivider />

      {/* Two-column master-detail */}
      <div className="grid grid-cols-[200px_1fr] min-h-80 divide-x divide-border/30">
        {/* Left: Provider list */}
        <div className="flex flex-col gap-0.5 pr-4">
          {/* Draft entry */}
          {draft && (
            <button
              type="button"
              onClick={() => {
                setSelectedId(draft.id)
              }}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
                isDraftSelected ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              <span className="flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <PlusIcon className="size-3.5" />
              </span>
              <span className="text-[12px] font-medium truncate">New Provider</span>
            </button>
          )}

          {/* Existing providers */}
          {profiles.map((profile) => {
            const active = selectedId === profile.id && !isDraftSelected
            const presetMatch = PROVIDER_PRESETS.find(p => p.providerKind === profile.providerKind)
            const accent = PROVIDER_ACCENT[presetMatch?.accent ?? 'violet'] ?? PROVIDER_ACCENT.violet
            const Icon = PROVIDER_ICONS[presetMatch?.id ?? ''] ?? PROVIDER_ICONS.custom
            return (
              <button
                key={profile.id}
                type="button"
                onClick={() => {
                  setSelectedId(profile.id)
                  setDraft(null)
                }}
                className={cn(
                  'group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
                  active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                )}
              >
                <span className={cn(
                  'flex size-7 items-center justify-center rounded-lg shrink-0',
                  accent.bg,
                  accent.text,
                )}
                >
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <span className={cn('block text-[12px] truncate', active ? 'font-medium' : 'text-foreground')}>
                    {profile.name}
                  </span>
                  {!profile.enabled && (
                    <span className="text-[10px] text-muted-foreground">Disabled</span>
                  )}
                </div>
              </button>
            )
          })}

          {profiles.length === 0 && !draft && (
            <p className="px-2 py-4 text-[11px] text-muted-foreground text-center">
              No providers configured
            </p>
          )}
        </div>

        {/* Right: Detail panel */}
        <div className="flex flex-col pl-6">
          {isDraftSelected && (
            <DraftSetupPanel
              draft={draft}
              onSelectPreset={presetId => setDraft({ ...draft, presetId })}
              onComplete={handleDraftComplete}
              onCancel={() => {
                setDraft(null)
                setSelectedId(null)
              }}
            />
          )}

          {selectedProfile && !isDraftSelected && (
            <SelectedProfilePanel
              profile={selectedProfile}
              onRemove={() => void handleRemoveProfile(selectedProfile.id)}
              onToggle={enabled => void handleToggleProfile(selectedProfile.id, enabled)}
              onSaved={() => void refreshProfiles()}
            />
          )}

          {!isDraftSelected && !selectedProfile && (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-[12px] text-muted-foreground">
                Select a provider or add a new one
              </p>
            </div>
          )}
        </div>
      </div>

    </div>
  )
}

// ── Draft setup panel (right column for new providers) ────────────────────────

function DraftSetupPanel({
  draft,
  onSelectPreset,
  onComplete,
  onCancel,
}: {
  draft: DraftProvider
  onSelectPreset: (presetId: string) => void
  onComplete: () => void
  onCancel: () => void
}) {
  const preset = PROVIDER_PRESETS.find(p => p.id === draft.presetId) ?? null

  if (!preset) {
    // Show preset picker
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-foreground">Choose a provider</p>
          <Button variant="ghost" size="sm" className="h-6 text-[11px] text-muted-foreground" onClick={onCancel}>
            Cancel
          </Button>
        </div>
        <div className="flex flex-col gap-0.5">
          {PROVIDER_PRESETS.map((p) => {
            const accent = PROVIDER_ACCENT[p.accent] ?? PROVIDER_ACCENT.violet
            const Icon = PROVIDER_ICONS[p.id] ?? PROVIDER_ICONS.custom
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelectPreset(p.id)}
                className="flex items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/50"
              >
                <span className={cn(
                  'flex size-7 items-center justify-center rounded-lg shrink-0',
                  accent.bg,
                  accent.text,
                )}
                >
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium text-foreground">{p.name}</div>
                  <div className="text-[11px] text-muted-foreground">{p.tagline}</div>
                </div>
                <ChevronRightIcon className="size-3 text-muted-foreground/50" />
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // Show setup form for selected preset
  return <PresetSetupForm preset={preset} onComplete={onComplete} onBack={() => onSelectPreset('')} />
}

// ── Preset setup form ─────────────────────────────────────────────────────────

function PresetSetupForm({
  preset,
  onComplete,
  onBack,
}: {
  preset: ProviderPreset
  onComplete: () => void
  onBack: () => void
}) {
  const [name, setName] = useState(preset.name)
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean, text: string } | null>(null)

  const profileId = name.trim().toLowerCase().replace(RE_WHITESPACE, '-') || preset.id

  const handleConnect = useCallback(async () => {
    setBusy(true)
    setStatus(null)

    try {
      let credentialRef: string | null = null
      const apiKey = values.apiKey
      if (apiKey) {
        const { data: meta } = await postSecrets({
          body: { kind: preset.providerKind, label: name, secret: apiKey } as unknown as never,
        })
        credentialRef = (meta as Record<string, unknown>)?.id as string ?? null
      }

      const config: Record<string, unknown> = { ...preset.defaults }
      if (values.baseUrl) {
        config.baseUrl = values.baseUrl
      }

      await putProfilesById({
        path: { id: profileId },
        body: { name, providerKind: preset.providerKind, enabled: true, config, credentialRef },
      })

      try {
        const { data: hcResult } = await postProvidersHealthCheck({
          body: { providerKind: preset.providerKind, label: name, config, secretRef: credentialRef, profileId },
        })
        const hc = hcResult as { ok: boolean, errorText?: string } | null
        if (hc?.ok) {
          setStatus({ ok: true, text: 'Connected' })
          setTimeout(onComplete, 500)
        }
 else {
          setStatus({ ok: false, text: hc?.errorText ?? 'Verification failed' })
          onComplete()
        }
      }
 catch {
        setStatus({ ok: true, text: 'Saved' })
        setTimeout(onComplete, 400)
      }
    }
 catch (err) {
      setStatus({ ok: false, text: 'Failed to save' })
      console.error('[ProviderSetup]', err)
    }
 finally {
      setBusy(false)
    }
  }, [preset, name, values, profileId, onComplete])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">
          ← Back
        </button>
        <span className="text-[13px] font-medium text-foreground">{preset.name}</span>
        <span className="text-[11px] text-muted-foreground">{preset.tagline}</span>
      </div>

      {/* Form */}
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Name</label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder={preset.name} className="h-8 text-[13px]" />
        </div>

        {preset.fields.map(field => (
          <div key={field.key}>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">{field.label}</label>
            <Input
              type={field.type === 'password' ? 'password' : 'text'}
              value={values[field.key] ?? ''}
              onChange={e => setValues(v => ({ ...v, [field.key]: e.target.value }))}
              placeholder={field.placeholder}
              className={cn('h-8 text-[13px]', field.mono && 'font-mono')}
            />
          </div>
        ))}

        {preset.fields.length === 0 && (
          <p className="text-[11px] text-muted-foreground/70">No credentials needed — uses local CLI.</p>
        )}
      </div>

      {/* Status */}
      {status && (
        <div className={cn('flex items-center gap-1.5 text-[11px]', status.ok ? 'text-emerald-500' : 'text-destructive')}>
          {status.ok ? <CheckCircleIcon className="size-3" /> : <XCircleIcon className="size-3" />}
          {status.text}
        </div>
      )}

      {/* Action */}
      <Button size="sm" className="h-7 w-fit text-[12px]" onClick={() => void handleConnect()} disabled={busy}>
        {busy && <Spinner className="size-3" />}
        {busy ? 'Connecting...' : 'Connect'}
      </Button>
    </div>
  )
}

// ── Selected profile detail panel (right column for existing providers) ───────

function SelectedProfilePanel({
  profile,
  onRemove,
  onToggle,
  onSaved,
}: {
  profile: AgentProfile
  onRemove: () => void
  onToggle: (enabled: boolean) => void
  onSaved: () => void
}) {
  const kind = PROVIDER_KINDS.find(k => k.id === profile.providerKind)
  const presetMatch = PROVIDER_PRESETS.find(p => p.providerKind === profile.providerKind)
  const accent = PROVIDER_ACCENT[presetMatch?.accent ?? 'violet'] ?? PROVIDER_ACCENT.violet
  const Icon = PROVIDER_ICONS[presetMatch?.id ?? ''] ?? PROVIDER_ICONS.custom
  const parsed = useMemo(() => {
    try {
      return JSON.parse(profile.configJson ?? '{}')
    }
    catch {
      return {}
    }
  }, [profile.configJson])

  const [name, setName] = useState(profile.name)
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(parsed.baseUrl ?? '')
  const [model, setModel] = useState(parsed.model ?? '')
  const [command, setCommand] = useState(parsed.executable ?? parsed.cmd ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [availableModels, setAvailableModels] = useState<ModelDescriptor[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [enabledModels, setEnabledModels] = useState<string[]>(
    !Array.isArray(parsed.enabledModels)
      ? []
      : parsed.enabledModels.length === 0
        ? [ALL_DISABLED_SENTINEL]
        : parsed.enabledModels,
  )

  // Reset form when profile changes
  useEffect(() => {
    setName(profile.name)
    setApiKey('')
    setBaseUrl(parsed.baseUrl ?? '')
    setModel(parsed.model ?? '')
    setCommand(parsed.executable ?? parsed.cmd ?? '')
    setSaved(false)
    setEnabledModels(
      !Array.isArray(parsed.enabledModels)
        ? []
        : parsed.enabledModels.length === 0
          ? [ALL_DISABLED_SENTINEL]
          : parsed.enabledModels,
    )
  }, [profile.id, profile.name, parsed])

  // Fetch models for supported providers
  const supportsModels = profile.providerKind === 'openai-compatible'
    || profile.providerKind === 'codex'
    || profile.providerKind === 'claude-agent'

  useEffect(() => {
    if (!supportsModels) {
      return
    }
    setModelsLoading(true)
    const config = (() => {
      try {
        return JSON.parse(profile.configJson)
      }
      catch {
        return {}
      }
    })()
    postProvidersModels({
      body: {
        providerKind: profile.providerKind,
        label: profile.name,
        config,
        secretRef: profile.credentialRef ?? null,
        profileId: profile.id,
      },
    })
      .then(({ data }) => setAvailableModels((data ?? []) as ModelDescriptor[]))
      .catch(() => setAvailableModels([]))
      .finally(() => setModelsLoading(false))
  }, [supportsModels, profile.id, profile.providerKind, profile.configJson, profile.name, profile.credentialRef])

  const handleSave = useCallback(async () => {
    setBusy(true)
    setSaved(false)
    try {
      let credentialRef = profile.credentialRef ?? null
      if (apiKey && supportsModels) {
        const { data: meta } = await postSecrets({
          body: { providerKind: profile.providerKind, label: name, secret: apiKey } as unknown as never,
        })
        credentialRef = (meta as Record<string, unknown>)?.id as string ?? credentialRef
      }

      let configJson = profile.configJson
      if (supportsModels) {
        const cleanEnabled = enabledModels.filter(id => id !== ALL_DISABLED_SENTINEL)
        configJson = JSON.stringify({
          baseUrl,
          model: model || undefined,
          enabledModels: cleanEnabled.length > 0 ? cleanEnabled : enabledModels[0] === ALL_DISABLED_SENTINEL ? [] : undefined,
        })
      }
      else if (profile.providerKind === 'cli-tui') {
        configJson = JSON.stringify({ executable: command, args: [] })
      }
      else if (profile.providerKind === 'acp-chat') {
        configJson = JSON.stringify({ ...parsed, cmd: command })
      }

      await putProfilesById({
        path: { id: profile.id },
        body: {
          name,
          providerKind: profile.providerKind,
          enabled: profile.enabled,
          config: JSON.parse(configJson),
          credentialRef,
        },
      })
      setSaved(true)
      onSaved()
    }
    catch (err) {
      console.error('[EditProvider]', err)
    }
    finally {
      setBusy(false)
    }
  }, [profile, name, apiKey, baseUrl, model, enabledModels, command, parsed, supportsModels, onSaved])

  return (
    <div className="flex flex-col gap-4">
      {/* Provider identity header */}
      <div className="flex items-center justify-between pb-3 border-b border-border/30">
        <div className="flex items-center gap-2.5">
          <span className={cn(
            'flex size-7 items-center justify-center rounded-lg',
            accent.bg,
            accent.text,
          )}
          >
            <Icon className="size-3.5" />
          </span>
          <div>
            <h4 className="text-[13px] font-medium text-foreground">{profile.name}</h4>
            <p className="text-[11px] text-muted-foreground">{kind?.label ?? profile.providerKind}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Switch size="sm" checked={profile.enabled} onCheckedChange={onToggle} />
          <button type="button" onClick={onRemove} className="text-muted-foreground/60 hover:text-destructive transition-colors">
            <TrashIcon className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Always-visible form fields */}
      <div className="flex flex-col divide-y divide-border/30">
        <SettingsRow label="Name" description="Display name for this provider">
          <Input value={name} onChange={e => setName(e.target.value)} className="h-8 w-48 text-[13px]" />
        </SettingsRow>

        {supportsModels && (
          <>
            <SettingsRow label="Endpoint" description="API base URL">
              <Input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} className="h-8 w-48 text-[13px] font-mono" />
            </SettingsRow>
            <SettingsRow label="Model" description="Default model">
              <Input value={model} onChange={e => setModel(e.target.value)} className="h-8 w-48 text-[13px] font-mono" />
            </SettingsRow>
            <SettingsRow label="API Key" description="Leave empty to keep current">
              <Input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." className="h-8 w-48 text-[13px] font-mono" />
            </SettingsRow>
            <SettingsRow label="Models" description="Visible in chat model selector" vertical>
              <AvailableModelsField
                loading={modelsLoading}
                models={availableModels}
                enabledModels={enabledModels}
                onToggle={(id, checked) => {
                  if (checked) {
                    setEnabledModels((prev) => {
                      const base = prev[0] === ALL_DISABLED_SENTINEL || prev.length === 0 ? availableModels.map(x => x.id) : prev
                      return [...base.filter(x => x !== id), id]
                    })
                  }
                  else {
                    setEnabledModels((prev) => {
                      const base = prev[0] === ALL_DISABLED_SENTINEL ? [] : prev.length === 0 ? availableModels.map(x => x.id) : prev
                      return base.filter(x => x !== id)
                    })
                  }
                }}
                onShowAll={() => setEnabledModels([])}
                onDisableAll={() => setEnabledModels([ALL_DISABLED_SENTINEL])}
              />
            </SettingsRow>
          </>
        )}

        {(profile.providerKind === 'cli-tui' || profile.providerKind === 'acp-chat') && (
          <SettingsRow label="Command" description="Executable to launch the agent">
            <Input value={command} onChange={e => setCommand(e.target.value)} className="h-8 w-52 text-[13px] font-mono" />
          </SettingsRow>
        )}
      </div>

      {/* Save action */}
      <div className="flex items-center gap-3">
        <Button size="sm" className="h-7 text-[12px]" onClick={() => void handleSave()} disabled={busy}>
          {busy && <Spinner className="size-3" />}
          Save changes
        </Button>
        {saved && (
          <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
            <CheckCircleIcon className="size-3" />
            Saved
          </span>
        )}
      </div>
    </div>
  )
}
