// Input: ipc.agentRuntime profile and credential methods, coss UI primitives
// Output: AgentRuntimeSettings component for unified Agent Profile management
// Position: Settings feature section for Agent Runtime provider configuration

import type { AgentProfile, ProviderKind } from '@main/ipc-types'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { cn } from '@renderer/lib/cn'
import { ipc } from '@renderer/lib/ipc'
import { CheckCircleIcon, PlusIcon, TrashIcon, XCircleIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

// ── Provider metadata ─────────────────────────────────────────────────────────

const PROVIDER_KINDS: Array<{ id: ProviderKind, label: string }> = [
  { id: 'openai-compatible', label: 'OpenAI-compatible' },
  { id: 'acp-chat', label: 'ACP Chat' },
  { id: 'cli-tui', label: 'CLI TUI' },
]

const DEFAULT_NAMES: Record<ProviderKind, string> = {
  'openai-compatible': 'OpenAI-compatible',
  'acp-chat': 'Local ACP',
  'cli-tui': 'Local CLI',
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

type ProviderFields
  = | { kind: 'openai-compatible', fields: OpenAIFields }
  | { kind: 'acp-chat', fields: AcpFields }
  | { kind: 'cli-tui', fields: CliTuiFields }

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

// ── Provider-specific form panels ─────────────────────────────────────────────

function OpenAIForm({ fields, onChange }: { fields: OpenAIFields, onChange: (f: OpenAIFields) => void }) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="agent-profile-name">名称</Label>
        <Input id="agent-profile-name" value={fields.name} onChange={e => onChange({ ...fields, name: e.target.value })} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="agent-baseurl">Base URL</Label>
        <Input id="agent-baseurl" value={fields.baseUrl} onChange={e => onChange({ ...fields, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="agent-model">默认模型</Label>
        <Input id="agent-model" value={fields.model} onChange={e => onChange({ ...fields, model: e.target.value })} placeholder="gpt-4o" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="agent-apikey">API Key</Label>
        <Input id="agent-apikey" type="password" value={fields.apiKey} onChange={e => onChange({ ...fields, apiKey: e.target.value })} placeholder="sk-..." />
      </div>
    </div>
  )
}

function AcpForm({ fields, onChange }: { fields: AcpFields, onChange: (f: AcpFields) => void }) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="agent-profile-name">名称</Label>
        <Input id="agent-profile-name" value={fields.name} onChange={e => onChange({ ...fields, name: e.target.value })} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="agent-dist">安装方式</Label>
        <Select
          value={fields.distributionType}
          onValueChange={(value) => onChange({ ...fields, distributionType: value as AcpFields['distributionType'] })}
        >
          <SelectTrigger id="agent-dist">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="npx">通过 npx 运行</SelectItem>
            <SelectItem value="global">全局安装命令</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="agent-pkg">包名 / 命令</Label>
        <Input id="agent-pkg" value={fields.packageName} onChange={e => onChange({ ...fields, packageName: e.target.value })} placeholder="@anthropic/claude-code" />
      </div>
    </div>
  )
}

function CliTuiForm({ fields, onChange }: { fields: CliTuiFields, onChange: (f: CliTuiFields) => void }) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="agent-profile-name">名称</Label>
        <Input id="agent-profile-name" value={fields.name} onChange={e => onChange({ ...fields, name: e.target.value })} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="agent-cmd">命令</Label>
        <Input id="agent-cmd" value={fields.command} onChange={e => onChange({ ...fields, command: e.target.value })} placeholder="claude" />
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function AgentRuntimeSettings() {
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [form, setForm] = useState<ProviderFields>(() => defaultFields('openai-compatible'))
  const [busyAdd, setBusyAdd] = useState(false)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [statusOk, setStatusOk] = useState<boolean | null>(null)

  const refreshProfiles = useCallback(async () => {
    if (!ipc) {
      return
    }
    setProfiles(await ipc.agentRuntime.listProfiles() as AgentProfile[])
  }, [])

  useEffect(() => {
    refreshProfiles().catch(() => setProfiles([]))
  }, [refreshProfiles])

  // All provider forms share the same 'name' field, so profileId just slugifies it
  const profileId = useMemo(() => buildProfileId(form.fields.name, form.kind), [form])

  const handleProviderChange = useCallback((value: string) => {
    const nextKind = value as ProviderKind
    setForm(defaultFields(nextKind))
    setStatusText(null)
    setStatusOk(null)
  }, [])

  const handleAddProfile = useCallback(async () => {
    if (!ipc) {
      return
    }
    setBusyAdd(true)
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

      await ipc.agentRuntime.upsertProfile({
        id: profileId,
        name: form.fields.name,
        providerKind: form.kind,
        enabled: true,
        configJson: buildConfigJson(form),
        credentialRef,
      })

      // Auto-probe after adding
      try {
        const result = await ipc.agentRuntime.probeProfile(profileId)
        setStatusOk(result.ok)
        setStatusText(result.ok ? `${result.label} 已就绪` : (result.errorText ?? '探测失败'))
      }
      catch {
        setStatusOk(false)
        setStatusText('保存成功，但探测失败')
      }

      await refreshProfiles()
    }
    catch (err) {
      setStatusOk(false)
      setStatusText('保存失败')
      console.error('[AgentRuntimeSettings]', err)
    }
    finally {
      setBusyAdd(false)
    }
  }, [form, profileId, refreshProfiles])

  const handleRemoveProfile = useCallback(async (id: string) => {
    if (!ipc) {
      return
    }
    await ipc.agentRuntime.removeProfile(id)
    await refreshProfiles()
  }, [refreshProfiles])

  return (
    <div className="flex flex-col gap-5" data-testid="agent-runtime-settings">
      <div>
        <h3 className="font-heading text-base font-semibold">Agents</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          添加 Agent Profile 来在会话中使用不同的 AI 提供商。
        </p>
      </div>

      {/* Add form */}
      <div className="grid gap-3 rounded-lg border bg-card/50 p-4">
        <div className="grid gap-1.5">
          <Label htmlFor="agent-provider-kind">类型</Label>
          <Select value={form.kind} onValueChange={handleProviderChange}>
            <SelectTrigger id="agent-provider-kind" data-testid="agent-provider-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_KINDS.map(kind => (
                <SelectItem key={kind.id} value={kind.id}>{kind.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {form.kind === 'openai-compatible' && (
          <OpenAIForm fields={form.fields} onChange={fields => setForm({ kind: 'openai-compatible', fields })} />
        )}
        {form.kind === 'acp-chat' && (
          <AcpForm fields={form.fields} onChange={fields => setForm({ kind: 'acp-chat', fields })} />
        )}
        {form.kind === 'cli-tui' && (
          <CliTuiForm fields={form.fields} onChange={fields => setForm({ kind: 'cli-tui', fields })} />
        )}

        <Button onClick={handleAddProfile} disabled={busyAdd} className="w-fit">
          <PlusIcon />
          添加
        </Button>
      </div>

      {statusText && (
        <div
          className={cn(
            'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
            statusOk === true && 'border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-400',
            statusOk === false && 'border-destructive/30 bg-destructive/5 text-destructive',
            statusOk === null && 'border-border bg-background text-muted-foreground',
          )}
        >
          {statusOk === true && <CheckCircleIcon className="size-3.5 shrink-0" />}
          {statusOk === false && <XCircleIcon className="size-3.5 shrink-0" />}
          {statusText}
        </div>
      )}

      {/* Profile list */}
      {profiles.length === 0
        ? (
          <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            还没有 Agent Profile
          </div>
        )
        : (
          <div className="flex flex-col gap-2" data-testid="agent-profile-list">
            {profiles.map(profile => (
              <div key={profile.id} className="flex items-center gap-3 rounded-lg border bg-card/50 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{profile.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {PROVIDER_KINDS.find(k => k.id === profile.providerKind)?.label ?? profile.providerKind}
                  </div>
                </div>
                <span className={cn(
                  'rounded px-2 py-0.5 text-xs',
                  profile.enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                )}
                >
                  {profile.enabled ? '已启用' : '已禁用'}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="移除 Profile"
                  onClick={() => handleRemoveProfile(profile.id)}
                >
                  <TrashIcon />
                </Button>
              </div>
            ))}
          </div>
        )}
    </div>
  )
}
