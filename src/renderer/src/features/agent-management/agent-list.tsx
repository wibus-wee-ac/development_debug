// Input: useAgents hook, useAgentProfiles, useAgentModels, AgentSkillsConfig, coss UI, DiceBear API, motion/react
// Output: AgentList — Settings page for managing Agent identities with character-sheet creation UX and per-agent skills
// Position: Settings section rendered under "Agents" tab; replaces nothing (new feature)

import type { Agent, AgentProfile, AgentSkillConfig, AgentSkillReference, CreateAgentInput, ModelDescriptor } from '@main/ipc-types'
import { Button } from '@renderer/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@renderer/components/ui/select'
import { Spinner } from '@renderer/components/ui/spinner'
import { Switch } from '@renderer/components/ui/switch'
import { useAgentModels } from '@renderer/features/agent-runtime/use-agent-models'
import { useAgentProfiles } from '@renderer/features/agent-runtime/use-agent-profiles'
import { useAgents } from '@renderer/features/agent-runtime/use-agents'
import { AgentSkillsConfig } from '@renderer/features/skills'
import { cn } from '@renderer/lib/cn'
import {
  BrainIcon,
  DicesIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useMemo, useRef, useState } from 'react'

// ── Constants ─────────────────────────────────────────────────────────────────

const AVATAR_STYLES = [
  { id: 'bottts-neutral', label: 'Bottts' },
  { id: 'thumbs', label: 'Thumbs' },
  { id: 'shapes', label: 'Shapes' },
  { id: 'identicon', label: 'Identicon' },
  { id: 'pixel-art', label: 'Pixel' },
  { id: 'adventurer', label: 'Adventurer' },
] as const

type ThinkingEffort = 'low' | 'medium' | 'high' | 'auto'

interface AgentEditorConfigState {
  baseConfig: Record<string, unknown>
  systemPrompt: string
  skills: AgentSkillConfig
}

function buildAvatarUrl(style: string, seed: string): string {
  return `https://api.dicebear.com/9.x/${encodeURIComponent(style)}/svg?seed=${encodeURIComponent(seed)}`
}

function generateSeed(): string {
  return Math.random().toString(36).slice(2, 10)
}

const KIND_LABELS: Record<string, string> = {
  'openai-compatible': 'OpenAI',
  'acp-chat': 'ACP',
  'cli-tui': 'CLI',
}

function parseAgentEditorConfig(configJson?: string | null): AgentEditorConfigState {
  try {
    const parsed = JSON.parse(configJson ?? '{}') as Record<string, unknown>
    const systemPrompt = typeof parsed.systemPrompt === 'string' ? parsed.systemPrompt : ''
    const rawSkills = parsed.skills
    const skills = rawSkills && typeof rawSkills === 'object' && !Array.isArray(rawSkills)
      ? {
          mode: (rawSkills as { mode?: unknown }).mode === 'selected' ? 'selected' as const : 'inherit' as const,
          selected: Array.isArray((rawSkills as { selected?: unknown }).selected)
            ? ((rawSkills as { selected: unknown[] }).selected.flatMap((item) => {
                if (!item || typeof item !== 'object') {
                  return []
                }
                const ref = item as Record<string, unknown>
                const scope = ref.scope
                const name = ref.name
                if ((scope === 'builtin' || scope === 'global' || scope === 'workspace') && typeof name === 'string') {
                  return [{ scope: scope as AgentSkillReference['scope'], name }]
                }
                return []
              }))
            : [],
        }
      : { mode: 'inherit' as const, selected: [] }

    const { systemPrompt: _discardSystemPrompt, skills: _discardSkills, ...baseConfig } = parsed
    return {
      baseConfig,
      systemPrompt,
      skills,
    }
  }
  catch {
    return {
      baseConfig: {},
      systemPrompt: '',
      skills: { mode: 'inherit', selected: [] },
    }
  }
}

function stringifyAgentEditorConfig(config: AgentEditorConfigState): string {
  const nextConfig: Record<string, unknown> = {
    ...config.baseConfig,
  }

  if (config.systemPrompt.trim()) {
    nextConfig.systemPrompt = config.systemPrompt.trim()
  }
  else {
    delete nextConfig.systemPrompt
  }

  if (config.skills.mode === 'selected' || (config.skills.selected?.length ?? 0) > 0) {
    nextConfig.skills = {
      mode: config.skills.mode === 'selected' ? 'selected' : 'inherit',
      selected: config.skills.selected ?? [],
    }
  }
  else {
    delete nextConfig.skills
  }

  return JSON.stringify(nextConfig)
}

// ── Agent Editor — Character Sheet ────────────────────────────────────────────
//
// Design concept: Avatar-first identity creation.
// The avatar is the hero — click it to shuffle. Style selector orbits below.
// Name is a hero-sized transparent input that feels like naming, not filling a form.
// Configuration (provider, model, effort) lives in a recessed tray below the identity zone.

interface AgentEditorProps {
  profiles: AgentProfile[]
  initial?: Agent
  onSave: (input: CreateAgentInput) => Promise<void>
  onCancel: () => void
  saving: boolean
}

function AgentEditor({ profiles, initial, onSave, onCancel, saving }: AgentEditorProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [avatarStyle, setAvatarStyle] = useState(initial?.avatarStyle ?? 'bottts-neutral')
  const [avatarSeed, setAvatarSeed] = useState(() => initial?.avatarSeed ?? generateSeed())
  const [providerId, setProviderId] = useState<string | null>(initial?.providerId ?? profiles[0]?.id ?? null)
  const [modelId, setModelId] = useState<string | null>(initial?.modelId ?? null)
  const [thinkingEffort, setThinkingEffort] = useState<ThinkingEffort>(
    (initial?.thinkingEffort as ThinkingEffort) ?? 'auto',
  )
  const initialConfig = useMemo(() => parseAgentEditorConfig(initial?.configJson), [initial?.configJson])
  const [systemPrompt, setSystemPrompt] = useState(initialConfig.systemPrompt)
  const [skillConfig, setSkillConfig] = useState<AgentSkillConfig>(initialConfig.skills)
  const [avatarSpinKey, setAvatarSpinKey] = useState(0)
  const nameRef = useRef<HTMLInputElement>(null)

  const enabledProviders = useMemo(() => profiles.filter(p => p.enabled), [profiles])
  const canSave = name.trim().length > 0 && providerId !== null
  const avatarUrl = buildAvatarUrl(avatarStyle, avatarSeed)

  const shuffleAvatar = useCallback(() => {
    setAvatarSeed(generateSeed())
    setAvatarSpinKey(k => k + 1)
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!canSave) {
      return
    }
    await onSave({
      name: name.trim(),
      description: description.trim() || null,
      avatarStyle,
      avatarSeed,
      providerId: providerId!,
      modelId,
      thinkingEffort,
      configJson: stringifyAgentEditorConfig({
        baseConfig: initialConfig.baseConfig,
        systemPrompt,
        skills: skillConfig,
      }),
    })
  }, [canSave, name, description, avatarStyle, avatarSeed, providerId, modelId, thinkingEffort, initialConfig.baseConfig, systemPrompt, skillConfig, onSave])

  const isAuto = thinkingEffort === 'auto'

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className="overflow-hidden"
    >
      <div className="rounded-xl bg-foreground/2 p-5">
        <div className="flex gap-6">
          {/* ── Left: Avatar Zone ────────────────────────────────── */}
          <div className="flex w-36 shrink-0 flex-col items-center gap-3 pt-1">
            {/* Avatar — clickable to shuffle */}
            <motion.button
              type="button"
              onClick={shuffleAvatar}
              className="group relative size-28 cursor-pointer overflow-hidden rounded-2xl bg-foreground/3 ring-2 ring-transparent transition-shadow hover:ring-foreground/10"
              title="Click to shuffle"
              whileTap={{ scale: 0.92 }}
            >
              <motion.img
                key={avatarSpinKey}
                src={avatarUrl}
                alt="Agent avatar"
                className="size-full object-cover"
                crossOrigin="anonymous"
                initial={{ rotate: -8, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                <DicesIcon className="size-5 text-white" />
              </div>
            </motion.button>

            {/* Style thumbnails — 3×2 grid */}
            <div className="grid grid-cols-3 gap-1.5">
              {AVATAR_STYLES.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setAvatarStyle(s.id)}
                  className={cn(
                    'size-8 overflow-hidden rounded-lg transition-all',
                    avatarStyle === s.id
                      ? 'ring-2 ring-foreground/20 scale-110'
                      : 'opacity-50 hover:opacity-80',
                  )}
                >
                  <img
                    src={buildAvatarUrl(s.id, avatarSeed)}
                    alt={s.label}
                    className="size-full object-cover"
                    crossOrigin="anonymous"
                  />
                </button>
              ))}
            </div>
          </div>

          {/* ── Right: Identity + Config ─────────────────────────── */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Name — hero transparent input */}
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Name your agent"
              autoFocus
              data-testid="agent-name-input"
              className={cn(
                'w-full bg-transparent text-lg font-semibold tracking-tight outline-none',
                'text-foreground placeholder:text-muted-foreground/30',
              )}
            />

            {/* Description — subtle, appears when name exists */}
            <AnimatePresence>
              {(name.length > 0 || description.length > 0) && (
                <motion.input
                  type="text"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Add a description..."
                  initial={{ height: 0, opacity: 0, marginTop: 0 }}
                  animate={{ height: 'auto', opacity: 1, marginTop: 4 }}
                  exit={{ height: 0, opacity: 0, marginTop: 0 }}
                  className={cn(
                    'w-full bg-transparent text-xs outline-none',
                    'text-muted-foreground placeholder:text-muted-foreground/20',
                  )}
                />
              )}
            </AnimatePresence>

            {/* Config tray — separated by space */}
            <div className="mt-4 grid gap-3">
              {/* Provider + Model — side by side */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-muted-foreground">Provider</span>
                  <Select
                    value={providerId ?? undefined}
                    onValueChange={(value) => {
                      setProviderId(value)
                      setModelId(null)
                    }}
                  >
                    <SelectTrigger size="sm">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {enabledProviders.map(p => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <ModelField
                  profileId={providerId}
                  modelId={modelId}
                  onModelChange={setModelId}
                />
              </div>

              {/* Thinking Effort */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <BrainIcon className="size-3" />
                    Thinking
                  </span>
                  <button
                    type="button"
                    onClick={() => setThinkingEffort(isAuto ? 'medium' : 'auto')}
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[10px] transition-colors',
                      isAuto
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    Auto
                  </button>
                </div>

                <div
                  className={cn(
                    'grid grid-cols-3 gap-px rounded-md bg-foreground/5 p-px',
                    isAuto && 'opacity-30 pointer-events-none',
                  )}
                >
                  {(['low', 'medium', 'high'] as const).map(level => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setThinkingEffort(level)}
                      className={cn(
                        'rounded-[5px] py-1 text-[11px] font-medium capitalize transition-colors',
                        thinkingEffort === level
                          ? 'bg-foreground text-background'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>

              {/* System Prompt */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] text-muted-foreground">System Prompt</span>
                <textarea
                  value={systemPrompt}
                  onChange={e => setSystemPrompt(e.target.value)}
                  placeholder="Optional instructions for this agent..."
                  rows={3}
                  className={cn(
                    'w-full resize-none rounded-md bg-foreground/3 px-2.5 py-2 text-xs outline-none',
                    'text-foreground placeholder:text-muted-foreground/20',
                    'focus:ring-1 focus:ring-foreground/10',
                  )}
                />
              </div>

              <AgentSkillsConfig
                value={skillConfig}
                onChange={setSkillConfig}
              />
            </div>

            {/* Actions — right-aligned at bottom */}
            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onCancel}
                disabled={saving}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={!canSave || saving}
                className="bg-foreground text-background hover:bg-foreground/90"
                data-testid="agent-save-btn"
              >
                {saving && <Spinner className="size-3.5" />}
                {initial ? 'Save' : 'Create Agent'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// ── Model Field (inline) ──────────────────────────────────────────────────────

function ModelField({
  profileId,
  modelId,
  onModelChange,
}: {
  profileId: string | null
  modelId: string | null
  onModelChange: (id: string | null) => void
}) {
  const { models, isLoading } = useAgentModels(profileId)

  if (!profileId) {
    return <div />
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-muted-foreground">Model</span>
      {isLoading
        ? (
          <div className="flex h-8 items-center gap-1.5 text-[11px] text-muted-foreground">
            <Spinner className="size-3" />
            Loading…
          </div>
        )
        : models.length === 0
          ? (
            <div className="flex h-8 items-center text-[11px] text-muted-foreground">
              No models
            </div>
          )
          : (
            <Select
              value={modelId ?? models[0]?.id ?? undefined}
              onValueChange={(value) => onModelChange(value)}
            >
              <SelectTrigger size="sm">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {models.map((m: ModelDescriptor) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label ?? m.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
    </div>
  )
}

// ── Agent Row ─────────────────────────────────────────────────────────────────

function AgentRow({
  agent,
  profiles,
  onEdit,
  onRemove,
  onToggle,
}: {
  agent: Agent
  profiles: AgentProfile[]
  onEdit: () => void
  onRemove: () => void
  onToggle: () => void
}) {
  const provider = profiles.find(p => p.id === agent.providerId)
  const avatarUrl = agent.avatarUrl || buildAvatarUrl(agent.avatarStyle, agent.avatarSeed)

  return (
    <div
      className={cn(
        'group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-foreground/3',
        !agent.enabled && 'opacity-50',
      )}
      data-testid={`agent-row-${agent.id}`}
    >
      {/* Avatar */}
      <div className="size-9 shrink-0 overflow-hidden rounded-xl bg-foreground/3">
        <img
          src={avatarUrl}
          alt={agent.name}
          className="size-full object-cover"
          crossOrigin="anonymous"
        />
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{agent.name}</span>
          {provider && (
            <span className="shrink-0 rounded bg-foreground/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {KIND_LABELS[provider.providerKind] ?? provider.providerKind}
            </span>
          )}
          {agent.modelId && (
            <span className="shrink-0 truncate rounded bg-foreground/5 px-1.5 py-0.5 text-[10px] text-muted-foreground max-w-32">
              {agent.modelId}
            </span>
          )}
        </div>
        {agent.description && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{agent.description}</p>
        )}
      </div>

      {/* Actions — fade in on hover */}
      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button variant="ghost" size="icon-xs" onClick={onEdit} aria-label="Edit">
          <PencilIcon className="size-3" />
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={onRemove} aria-label="Remove">
          <Trash2Icon className="size-3" />
        </Button>
      </div>

      <Switch
        checked={agent.enabled}
        onCheckedChange={onToggle}
      />
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function AgentList() {
  const { agents, isLoading, createAgent, updateAgent, removeAgent } = useAgents()
  const { profiles } = useAgentProfiles()

  const [creatingNew, setCreatingNew] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleCreate = useCallback(async (input: CreateAgentInput) => {
    setSaving(true)
    try {
      await createAgent.mutateAsync(input)
      setCreatingNew(false)
    }
    finally {
      setSaving(false)
    }
  }, [createAgent])

  const handleUpdate = useCallback(async (id: string, input: CreateAgentInput) => {
    setSaving(true)
    try {
      await updateAgent.mutateAsync({ id, patch: input })
      setEditingId(null)
    }
    finally {
      setSaving(false)
    }
  }, [updateAgent])

  const handleRemove = useCallback(async (id: string) => {
    await removeAgent.mutateAsync(id)
  }, [removeAgent])

  const handleToggle = useCallback(async (agent: Agent) => {
    await updateAgent.mutateAsync({ id: agent.id, patch: { enabled: !agent.enabled } })
  }, [updateAgent])

  return (
    <div className="flex flex-col gap-6" data-testid="agent-list">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Agents</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Create AI agents with unique identities bound to your providers.
          </p>
        </div>
        {!creatingNew && (
          <Button
            size="sm"
            onClick={() => {
              setCreatingNew(true)
              setEditingId(null)
            }}
            className="bg-foreground text-background hover:bg-foreground/90"
            data-testid="new-agent-btn"
          >
            <PlusIcon className="size-3.5" />
            New Agent
          </Button>
        )}
      </div>

      {/* Inline create form */}
      <AnimatePresence>
        {creatingNew && (
          <AgentEditor
            key="create"
            profiles={profiles}
            onSave={handleCreate}
            onCancel={() => setCreatingNew(false)}
            saving={saving}
          />
        )}
      </AnimatePresence>

      {/* Agent list */}
      {isLoading
        ? (
          <div className="flex justify-center py-12">
            <Spinner className="size-4 text-muted-foreground" />
          </div>
        )
        : agents.length === 0 && !creatingNew
          ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <p className="text-sm text-muted-foreground" data-testid="agent-empty-state">No agents yet</p>
              <p className="text-xs text-muted-foreground">
                Create an agent to give your AI a name, avatar, and preferred model.
              </p>
            </div>
          )
          : (
            <div className="flex flex-col">
              {agents.map(agent => (
                <div key={agent.id}>
                  {editingId === agent.id
                    ? (
                      <AnimatePresence>
                        <AgentEditor
                          profiles={profiles}
                          initial={agent}
                          onSave={input => handleUpdate(agent.id, input)}
                          onCancel={() => setEditingId(null)}
                          saving={saving}
                        />
                      </AnimatePresence>
                    )
                    : (
                      <AgentRow
                        agent={agent}
                        profiles={profiles}
                        onEdit={() => {
                          setEditingId(agent.id)
                          setCreatingNew(false)
                        }}
                        onRemove={() => handleRemove(agent.id)}
                        onToggle={() => handleToggle(agent)}
                      />
                    )}
                </div>
              ))}
            </div>
          )}
    </div>
  )
}
