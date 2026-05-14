// Input: useAgents, useAgentProfiles, useAgentModels hooks; Agent/AgentProfile/CreateAgentInput types; SkillManager; AlertDialog; motion/react
// Output: AgentDetailPage — profile-card identity zone + auto-saving config + private skills. Create and edit unified.
// Position: Rendered by AgentList in both create and edit modes

import { ArrowLeftIcon, CheckIcon, DicesIcon } from 'lucide-react'
import { m } from 'motion/react'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '~/components/ui/alert-dialog'
import { Button } from '~/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import { useAgentModels } from '~/features/agent-runtime/use-agent-models'
import { useAgents } from '~/features/agent-runtime/use-agents'
import { SkillManager } from '~/features/skills'
import { cn } from '~/lib/cn'
import type { Agent, AgentProfile, CreateAgentInput, ModelDescriptor } from '~/lib/types'

import { SettingsDivider } from '../settings/settings-row'

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
type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

interface AgentDetailFormValues {
  name: string
  description: string
  avatarStyle: string
  avatarSeed: string
  agentProfileId: string | null
  modelId: string | null
  thinkingEffort: ThinkingEffort
  systemPrompt: string
}

function buildAvatarUrl(style: string, seed: string): string {
  return `https://api.dicebear.com/9.x/${encodeURIComponent(style)}/svg?seed=${encodeURIComponent(seed)}`
}

function generateSeed(): string {
  return Math.random().toString(36).slice(2, 10)
}

function parseConfigJson(configJson?: string | null): { systemPrompt: string, baseConfig: Record<string, unknown> } {
  try {
    const parsed = JSON.parse(configJson ?? '{}') as Record<string, unknown>
    const systemPrompt = typeof parsed.systemPrompt === 'string' ? parsed.systemPrompt : ''
    const { systemPrompt: _sp, skills: _sk, ...baseConfig } = parsed
    return { systemPrompt, baseConfig }
  }
  catch {
    return { systemPrompt: '', baseConfig: {} }
  }
}

function stringifyConfigJson(systemPrompt: string, baseConfig: Record<string, unknown>): string {
  const config: Record<string, unknown> = { ...baseConfig }
  if (systemPrompt.trim()) {
    config.systemPrompt = systemPrompt
  }
  return JSON.stringify(config)
}

function getAgentDetailFormValues(agent: Agent | undefined, enabledProfiles: AgentProfile[]): AgentDetailFormValues {
  const initialConfig = parseConfigJson(agent?.configJson)
  return {
    name: agent?.name ?? '',
    description: agent?.description ?? '',
    avatarStyle: agent?.avatarStyle ?? AVATAR_STYLES[0].id,
    avatarSeed: agent?.avatarSeed ?? generateSeed(),
    agentProfileId: agent?.agentProfileId ?? enabledProfiles[0]?.id ?? null,
    modelId: agent?.modelId ?? null,
    thinkingEffort: (agent?.thinkingEffort as ThinkingEffort) ?? 'auto',
    systemPrompt: initialConfig.systemPrompt,
  }
}

// ── Model Select ──────────────────────────────────────────────────────────────

interface ModelSelectChangeOptions {
  shouldDirty?: boolean
}

function ModelSelect({
  profileId,
  modelId,
  onModelChange,
}: {
  profileId: string | null
  modelId: string | null
  onModelChange: (id: string | null, options?: ModelSelectChangeOptions) => void
}) {
  const { models, isLoading } = useAgentModels(profileId)
  const applyDefaultModel = useEffectEvent((nextModelId: string) => {
    onModelChange(nextModelId, { shouldDirty: false })
  })

  useEffect(() => {
    if (!profileId || modelId !== null || models.length === 0) {
      return
    }
    applyDefaultModel(models[0]!.id)
  }, [profileId, modelId, models])

  if (!profileId) {
    return <span className="text-[11px] text-muted-foreground/50" data-testid="agent-model-empty">–</span>
  }

  if (isLoading) {
    return <Spinner className="size-3 text-muted-foreground" data-testid="agent-model-loading" />
  }

  if (models.length === 0) {
    return <span className="text-[11px] text-muted-foreground/50" data-testid="agent-model-empty">No models</span>
  }

  return (
    <Select value={modelId ?? models[0]?.id ?? undefined} onValueChange={value => onModelChange(value, { shouldDirty: true })}>
      <SelectTrigger size="sm" className="h-7 text-xs" data-testid="agent-model-select">
        <SelectValue placeholder="Model" />
      </SelectTrigger>
      <SelectContent>
        {models.map((m: ModelDescriptor) => (
          <SelectItem key={m.id} value={m.id} className="text-xs">
            {m.label ?? m.id}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// ── Save Indicator ─────────────────────────────────────────────────────────────

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') {
    return null
  }

  return (
    <m.span
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className={cn(
        'flex items-center gap-1 text-[11px]',
        state === 'saving' || state === 'pending' ? 'text-muted-foreground' : '',
        state === 'saved' ? 'text-emerald-600 dark:text-emerald-400' : '',
        state === 'error' ? 'text-destructive' : '',
      )}
    >
      {(state === 'saving' || state === 'pending') && <Spinner className="size-2.5" />}
      {state === 'saved' && <CheckIcon className="size-3" />}
      {state === 'saving' && 'Saving...'}
      {state === 'pending' && 'Saving...'}
      {state === 'saved' && 'Saved'}
      {state === 'error' && 'Save failed'}
    </m.span>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function AgentDetailPage({
  agent,
  profiles,
  onBack,
  onCreated,
  onDeleted,
}: {
  agent?: Agent
  profiles: AgentProfile[]
  onBack: () => void
  onCreated?: (agentId: string) => void
  onDeleted?: () => void
}) {
  const isCreate = agent === undefined
  const { createAgent, updateAgent, removeAgent } = useAgents()
  const persistedConfig = useMemo(() => parseConfigJson(agent?.configJson), [agent?.configJson])
  const enabledProfiles = useMemo(() => profiles.filter(p => p.enabled), [profiles])
  const form = useForm<AgentDetailFormValues>({
    defaultValues: getAgentDetailFormValues(agent, enabledProfiles),
  })
  const watchedValues = useWatch({ control: form.control }) as AgentDetailFormValues
  const name = watchedValues.name ?? ''
  const description = watchedValues.description ?? ''
  const avatarStyle = watchedValues.avatarStyle ?? AVATAR_STYLES[0].id
  const avatarSeed = watchedValues.avatarSeed ?? ''
  const agentProfileId = watchedValues.agentProfileId ?? null
  const modelId = watchedValues.modelId ?? null
  const thinkingEffort = watchedValues.thinkingEffort ?? 'auto'
  const systemPrompt = watchedValues.systemPrompt ?? ''

  const [avatarSpinKey, setAvatarSpinKey] = useState(0)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [createSaving, setCreateSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current)
    }
    if (savedClearTimer.current) {
      clearTimeout(savedClearTimer.current)
    }

    form.reset(getAgentDetailFormValues(agent, enabledProfiles))
    setSaveState('idle')
    setCreateSaving(false)
    setSaveError(null)
  }, [form, agent])

  useEffect(() => {
    if (agent || !enabledProfiles[0]) {
      return
    }
    if (form.getValues('agentProfileId') !== null) {
      return
    }
    form.setValue('agentProfileId', enabledProfiles[0].id, { shouldDirty: false })
  }, [agent, enabledProfiles, form])

  const isDirty = form.formState.isDirty
  const draftSignature = useMemo(() => JSON.stringify({
    name,
    description,
    avatarStyle,
    avatarSeed,
    agentProfileId,
    modelId,
    thinkingEffort,
    systemPrompt,
  }), [name, description, avatarStyle, avatarSeed, agentProfileId, modelId, thinkingEffort, systemPrompt])
  const saveDraft = useEffectEvent(async () => {
    if (!agent) {
      return
    }

    const currentValues = form.getValues()
    if (!currentValues.name.trim() || !currentValues.agentProfileId) {
      return
    }

    const normalizedValues = {
      ...currentValues,
      name: currentValues.name.trim(),
      description: currentValues.description.trim(),
    }

    setSaveState('saving')
    setSaveError(null)
    try {
      const configJson = stringifyConfigJson(currentValues.systemPrompt, persistedConfig.baseConfig)
      await updateAgent.mutateAsync({
        id: agent.id,
        patch: {
          name: normalizedValues.name,
          description: normalizedValues.description || null,
          avatarStyle: currentValues.avatarStyle,
          avatarSeed: currentValues.avatarSeed,
          agentProfileId: currentValues.agentProfileId,
          modelId: currentValues.modelId,
          thinkingEffort: currentValues.thinkingEffort,
          configJson,
        },
      })
      setSaveState('saved')
      form.reset(normalizedValues)
      if (savedClearTimer.current) {
        clearTimeout(savedClearTimer.current)
      }
      savedClearTimer.current = setTimeout(setSaveState, 2000, 'idle')
    }
    catch (err) {
      setSaveState('error')
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  })

  // Auto-save debounce for edit mode
  useEffect(() => {
    if (isCreate || !isDirty || saveState === 'saving') {
      return
    }
    setSaveState('pending')
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current)
    }
    autoSaveTimer.current = setTimeout(() => {
      void saveDraft()
    }, 1400)
    return () => {
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current)
      }
    }
  }, [isCreate, isDirty, saveState, draftSignature])

  const handleCreate = useCallback(async () => {
    const currentValues = form.getValues()
    if (!currentValues.name.trim() || !currentValues.agentProfileId) {
      return
    }

    const normalizedValues = {
      ...currentValues,
      name: currentValues.name.trim(),
      description: currentValues.description.trim(),
    }

    setCreateSaving(true)
    setSaveError(null)
    try {
      const created = await createAgent.mutateAsync({
        name: normalizedValues.name,
        description: normalizedValues.description || null,
        avatarStyle: currentValues.avatarStyle,
        avatarSeed: currentValues.avatarSeed,
        agentProfileId: currentValues.agentProfileId,
        modelId: currentValues.modelId,
        thinkingEffort: currentValues.thinkingEffort,
        configJson: stringifyConfigJson(currentValues.systemPrompt, {}),
      } satisfies CreateAgentInput)
      onCreated?.(created.id)
    }
    catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setCreateSaving(false)
    }
  }, [form, createAgent, onCreated])

  const handleDelete = useCallback(async () => {
    if (!agent) {
      return
    }
    await removeAgent.mutateAsync(agent.id)
    onDeleted?.()
  }, [agent, removeAgent, onDeleted])

  const shuffleAvatar = useCallback(() => {
    form.setValue('avatarSeed', generateSeed(), { shouldDirty: true })
    setAvatarSpinKey(k => k + 1)
  }, [form])

  const avatarUrl = buildAvatarUrl(avatarStyle, avatarSeed)
  const isAuto = thinkingEffort === 'auto'

  return (
    <div className="flex flex-col gap-0" data-testid={agent ? `agent-detail-${agent.id}` : 'agent-create'}>

      {/* ── Nav bar ──────────────────────────────────────────── */}
      <div className="mb-6 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          data-testid="agent-detail-back"
          className="flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          Agents
        </button>

        <div className="flex items-center gap-3">
          {!isCreate && <SaveIndicator state={saveState} />}

          {!isCreate && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  data-testid="agent-detail-delete-trigger"
                  className="text-[11px] text-muted-foreground/40 transition-colors hover:text-destructive"
                >
                  Delete
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Delete
                    {' '}
                    {agent?.name}
                    ?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently remove the agent and all its private skills.
                    This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => void handleDelete()}
                    className="bg-destructive text-white hover:bg-destructive/90"
                    data-testid="agent-detail-delete-confirm"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* ── Identity card ────────────────────────────────────── */}
      <div className="flex items-start gap-5">
        {/* Avatar + style */}
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <m.button
            type="button"
            onClick={shuffleAvatar}
            data-testid="agent-avatar-preview"
            className="group relative size-18 cursor-pointer overflow-hidden rounded-2xl bg-foreground/5"
            title="Click to shuffle"
            whileTap={{ scale: 0.91 }}
          >
            <m.img
              key={avatarSpinKey}
              src={avatarUrl}
              alt={name || 'Agent'}
              className="size-full object-cover"
              crossOrigin="anonymous"
              initial={{ scale: 0.82, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 380, damping: 22 }}
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity group-hover:opacity-100">
              <DicesIcon className="size-4 text-white" />
            </div>
          </m.button>

          <Select value={avatarStyle} onValueChange={value => form.setValue('avatarStyle', value, { shouldDirty: true })}>
            <SelectTrigger
              size="sm"
              data-testid="agent-avatar-style"
              className="h-5 w-18 border-0 bg-transparent px-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AVATAR_STYLES.map(s => (
                <SelectItem key={s.id} value={s.id} className="text-xs">
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Name, tagline, model config */}
        <div className="flex min-w-0 flex-1 flex-col gap-4 pt-1">
          {/* Name + tagline */}
          <div className="flex flex-col gap-0.5">
            <input
              type="text"
              {...form.register('name')}
              placeholder="Name your agent"
              autoFocus={isCreate}
              data-testid="agent-detail-name"
              className="bg-transparent text-[17px] font-semibold leading-tight text-foreground outline-none placeholder:text-muted-foreground/25"
            />
            <input
              type="text"
              {...form.register('description')}
              placeholder="Add a tagline..."
              data-testid="agent-detail-description"
              className="bg-transparent text-[12px] text-muted-foreground outline-none placeholder:text-muted-foreground/25"
            />
          </div>

          {/* Model config — compact inline row */}
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={agentProfileId ?? undefined}
              onValueChange={(v) => {
                form.setValue('agentProfileId', v, { shouldDirty: true })
                form.setValue('modelId', null, { shouldDirty: true })
              }}
            >
              <SelectTrigger size="sm" className="h-7 text-xs" data-testid="agent-provider-select">
                <SelectValue placeholder="Profile" />
              </SelectTrigger>
              <SelectContent>
                {enabledProfiles.map(p => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <ModelSelect
              profileId={agentProfileId}
              modelId={modelId}
              onModelChange={(id, options) => {
                form.setValue('modelId', id, { shouldDirty: options?.shouldDirty ?? true })
              }}
            />

            <div className="flex items-center gap-1">
              <div
                className={cn(
                  'flex gap-px rounded-md bg-foreground/6 p-px',
                  isAuto && 'opacity-30',
                )}
              >
                {(['low', 'medium', 'high'] as const).map(level => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => form.setValue('thinkingEffort', level, { shouldDirty: true })}
                    data-testid={`agent-thinking-${level}`}
                    className={cn(
                      'h-6.5 rounded-[5px] px-2.5 text-[11px] font-medium capitalize transition-colors',
                      thinkingEffort === level
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {level}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => form.setValue('thinkingEffort', isAuto ? 'medium' : 'auto', { shouldDirty: true })}
                data-testid="agent-thinking-auto"
                className={cn(
                  'h-6.5 rounded-md px-2.5 text-[11px] transition-colors',
                  isAuto
                    ? 'bg-foreground font-medium text-background'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Auto
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── System Prompt ────────────────────────────────────── */}
      <SettingsDivider />

      <div className="flex flex-col gap-2 py-4">
        <span className="text-[13px] font-medium text-foreground">System Prompt</span>
        <textarea
          {...form.register('systemPrompt')}
          placeholder="Optional instructions for this agent..."
          rows={5}
          data-testid="agent-detail-system-prompt"
          className={cn(
            'w-full resize-none rounded-md bg-foreground/4 px-3 py-2.5 text-[12px] outline-none',
            'text-foreground placeholder:text-muted-foreground/30',
            'transition-colors focus:bg-foreground/5',
          )}
        />
      </div>

      {/* ── Create action (create mode only) ─────────────────── */}
      {isCreate && (
        <>
          <SettingsDivider />
          <div className="flex items-center justify-end gap-2 py-4">
            {saveError && <p className="mr-auto text-[11px] text-destructive">{saveError}</p>}
            <Button variant="outline" size="sm" onClick={onBack}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleCreate()}
              disabled={!isDirty || createSaving || !name.trim() || !agentProfileId}
              data-testid="agent-detail-save"
            >
              {createSaving && <Spinner className="size-3.5" />}
              Create Agent
            </Button>
          </div>
        </>
      )}

      {/* ── Skills (edit mode only) ───────────────────────────── */}
      {!isCreate && agent && (
        <>
          <SettingsDivider />
          <SkillManager
            agentId={agent.id}
            editableScope="agent"
            title="Skills"
            description={`Agent-exclusive skills stored in ~/.cradle/agents/${agent.id}/skills`}
            pageTestId={`agent-skills-${agent.id}`}
          />
        </>
      )}

      {saveError && !isCreate && (
        <p className="mt-2 text-[11px] text-destructive">{saveError}</p>
      )}
    </div>
  )
}
