// Input: useAgents, useAgentProfiles, useAgentModels hooks; Agent/AgentProfile/CreateAgentInput types; SkillManager; AlertDialog; motion/react
// Output: AgentDetailPage — profile-card identity zone + auto-saving config + private skills. Create and edit unified.
// Position: Rendered by AgentList in both create and edit modes

import { ArrowLeftIcon, CheckIcon, DicesIcon } from 'lucide-react'
import { m } from 'motion/react'
import { useCallback, useEffect, useEffectEvent, useMemo, useReducer, useRef } from 'react'
import { FormProvider, useForm, useFormContext, useWatch } from 'react-hook-form'

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
import type { Agent, AgentProfile, CreateAgentInput, ModelDescriptor, RuntimeKind } from '~/lib/types'

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
  runtimeKind: RuntimeKind
  systemPrompt: string
}

interface AgentDetailUiState {
  avatarSpinKey: number
  saveState: SaveState
  createSaving: boolean
  saveError: string | null
}

type AgentDetailUiAction =
  | { type: 'reset' }
  | { type: 'avatar/spin' }
  | { type: 'save/state', state: SaveState }
  | { type: 'create/saving', value: boolean }
  | { type: 'save/error', error: string | null }

const INITIAL_AGENT_DETAIL_UI_STATE: AgentDetailUiState = {
  avatarSpinKey: 0,
  saveState: 'idle',
  createSaving: false,
  saveError: null,
}

function agentDetailUiReducer(state: AgentDetailUiState, action: AgentDetailUiAction): AgentDetailUiState {
  switch (action.type) {
    case 'reset':
      return { ...INITIAL_AGENT_DETAIL_UI_STATE }
    case 'avatar/spin':
      return { ...state, avatarSpinKey: state.avatarSpinKey + 1 }
    case 'save/state':
      return { ...state, saveState: action.state }
    case 'create/saving':
      return { ...state, createSaving: action.value }
    case 'save/error':
      return { ...state, saveError: action.error }
    default:
      return state
  }
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
    runtimeKind: (agent?.runtimeKind as RuntimeKind) ?? 'standard',
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

interface AgentDetailDraft {
  name: string
  description: string
  avatarStyle: string
  avatarSeed: string
  agentProfileId: string | null
  modelId: string | null
  thinkingEffort: ThinkingEffort
  runtimeKind: RuntimeKind
  systemPrompt: string
}

function AgentDetailHeader({
  isCreate,
  saveState,
  agentName,
  onBack,
  onDelete,
}: {
  isCreate: boolean
  saveState: SaveState
  agentName?: string
  onBack: () => void
  onDelete: () => void
}) {
  return (
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
                  {agentName}
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
                  onClick={() => void onDelete()}
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
  )
}

function ThinkingEffortControl({ thinkingEffort }: { thinkingEffort: ThinkingEffort }) {
  const form = useFormContext<AgentDetailFormValues>()
  const isAuto = thinkingEffort === 'auto'

  return (
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
  )
}

function AgentIdentitySection({
  draft,
  enabledProfiles,
  avatarUrl,
  avatarSpinKey,
  onShuffleAvatar,
}: {
  draft: AgentDetailDraft
  enabledProfiles: AgentProfile[]
  avatarUrl: string
  avatarSpinKey: number
  onShuffleAvatar: () => void
}) {
  const form = useFormContext<AgentDetailFormValues>()

  return (
    <div className="flex items-start gap-5">
      <div className="flex shrink-0 flex-col items-center gap-1.5">
        <m.button
          type="button"
          onClick={onShuffleAvatar}
          data-testid="agent-avatar-preview"
          className="group relative size-18 cursor-pointer overflow-hidden rounded-2xl bg-foreground/5"
          title="Click to shuffle"
          whileTap={{ scale: 0.91 }}
        >
          <m.img
            key={avatarSpinKey}
            src={avatarUrl}
            alt={draft.name || 'Agent'}
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

        <Select value={draft.avatarStyle} onValueChange={value => form.setValue('avatarStyle', value, { shouldDirty: true })}>
          <SelectTrigger
            size="sm"
            data-testid="agent-avatar-style"
            className="h-5 w-18 border-0 bg-transparent px-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AVATAR_STYLES.map(style => (
              <SelectItem key={style.id} value={style.id} className="text-xs">
                {style.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4 pt-1">
        <div className="flex flex-col gap-0.5">
          <input
            type="text"
            {...form.register('name')}
            placeholder="Name your agent"
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

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={draft.agentProfileId ?? undefined}
            onValueChange={(value) => {
              form.setValue('agentProfileId', value, { shouldDirty: true })
              form.setValue('modelId', null, { shouldDirty: true })
            }}
          >
            <SelectTrigger size="sm" className="h-7 text-xs" data-testid="agent-provider-select">
              <SelectValue placeholder="Profile" />
            </SelectTrigger>
            <SelectContent>
              {enabledProfiles.map(profile => (
                <SelectItem key={profile.id} value={profile.id} className="text-xs">
                  {profile.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <ModelSelect
            profileId={draft.agentProfileId}
            modelId={draft.modelId}
            onModelChange={(id, options) => {
              form.setValue('modelId', id, { shouldDirty: options?.shouldDirty ?? true })
            }}
          />

          <Select
            value={draft.runtimeKind}
            onValueChange={value => form.setValue('runtimeKind', value as RuntimeKind, { shouldDirty: true })}
          >
            <SelectTrigger size="sm" className="h-7 text-xs" data-testid="agent-runtime-select">
              <SelectValue placeholder="Runtime" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="standard" className="text-xs">Standard</SelectItem>
              <SelectItem value="claude-agent" className="text-xs">Claude Agent</SelectItem>
              <SelectItem value="codex" className="text-xs">Codex</SelectItem>
              <SelectItem value="cli-tui" className="text-xs">CLI / TUI</SelectItem>
            </SelectContent>
          </Select>

          <ThinkingEffortControl thinkingEffort={draft.thinkingEffort} />
        </div>
      </div>
    </div>
  )
}

function AgentSystemPromptSection() {
  const form = useFormContext<AgentDetailFormValues>()

  return (
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
  )
}

function AgentCreateActions({
  createSaving,
  createDisabled,
  saveError,
  onCancel,
  onCreate,
}: {
  createSaving: boolean
  createDisabled: boolean
  saveError: string | null
  onCancel: () => void
  onCreate: () => void
}) {
  return (
    <div className="flex items-center justify-end gap-2 py-4">
      {saveError && <p className="mr-auto text-[11px] text-destructive">{saveError}</p>}
      <Button variant="outline" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      <Button
        size="sm"
        onClick={() => void onCreate()}
        disabled={createDisabled}
        data-testid="agent-detail-save"
      >
        {createSaving && <Spinner className="size-3.5" />}
        Create Agent
      </Button>
    </div>
  )
}

function AgentSkillsSection({ agentId }: { agentId: string }) {
  return (
    <SkillManager
      agentId={agentId}
      editableScope="agent"
      title="Skills"
      description={`Agent-exclusive skills stored in ~/.cradle/agents/${agentId}/skills`}
      pageTestId={`agent-skills-${agentId}`}
    />
  )
}

function useAgentDetailOwner({
  agent,
  profiles,
  onCreated,
  onDeleted,
}: {
  agent?: Agent
  profiles: AgentProfile[]
  onCreated?: (agentId: string) => void
  onDeleted?: () => void
}) {
  const isCreate = agent === undefined
  const { createAgent, updateAgent, removeAgent } = useAgents()
  const persistedConfig = useMemo(() => parseConfigJson(agent?.configJson), [agent?.configJson])
  const enabledProfiles = useMemo(() => profiles.filter(profile => profile.enabled), [profiles])
  const form = useForm<AgentDetailFormValues>({
    defaultValues: getAgentDetailFormValues(agent, enabledProfiles),
  })
  const watchedValues = useWatch({ control: form.control }) as Partial<AgentDetailFormValues>
  const draft: AgentDetailDraft = {
    name: watchedValues.name ?? '',
    description: watchedValues.description ?? '',
    avatarStyle: watchedValues.avatarStyle ?? AVATAR_STYLES[0].id,
    avatarSeed: watchedValues.avatarSeed ?? '',
    agentProfileId: watchedValues.agentProfileId ?? null,
    modelId: watchedValues.modelId ?? null,
    thinkingEffort: watchedValues.thinkingEffort ?? 'auto',
    runtimeKind: watchedValues.runtimeKind ?? 'standard',
    systemPrompt: watchedValues.systemPrompt ?? '',
  }
  const [uiState, dispatch] = useReducer(agentDetailUiReducer, INITIAL_AGENT_DETAIL_UI_STATE)
  const { avatarSpinKey, saveState, createSaving, saveError } = uiState

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimers = useCallback(() => {
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current)
    }
    if (savedClearTimer.current) {
      clearTimeout(savedClearTimer.current)
    }
  }, [])

  useEffect(() => {
    return () => {
      clearTimers()
    }
  }, [clearTimers])

  useEffect(() => {
    clearTimers()
    form.reset(getAgentDetailFormValues(agent, enabledProfiles))
    dispatch({ type: 'reset' })
  }, [form, agent, clearTimers])

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
  const draftSignature = useMemo(() => JSON.stringify(draft), [draft])
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

    dispatch({ type: 'save/state', state: 'saving' })
    dispatch({ type: 'save/error', error: null })
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
          runtimeKind: currentValues.runtimeKind,
          configJson,
        },
      })
      dispatch({ type: 'save/state', state: 'saved' })
      form.reset(normalizedValues)
      if (savedClearTimer.current) {
        clearTimeout(savedClearTimer.current)
      }
      savedClearTimer.current = setTimeout(() => {
        dispatch({ type: 'save/state', state: 'idle' })
      }, 2000)
    }
    catch (err) {
      dispatch({ type: 'save/state', state: 'error' })
      dispatch({ type: 'save/error', error: err instanceof Error ? err.message : String(err) })
    }
  })

  useEffect(() => {
    if (isCreate || !isDirty || saveState === 'saving') {
      return
    }

    dispatch({ type: 'save/state', state: 'pending' })
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

    dispatch({ type: 'create/saving', value: true })
    dispatch({ type: 'save/error', error: null })
    try {
      const created = await createAgent.mutateAsync({
        name: normalizedValues.name,
        description: normalizedValues.description || null,
        avatarStyle: currentValues.avatarStyle,
        avatarSeed: currentValues.avatarSeed,
        agentProfileId: currentValues.agentProfileId,
        modelId: currentValues.modelId,
        thinkingEffort: currentValues.thinkingEffort,
        runtimeKind: currentValues.runtimeKind,
        configJson: stringifyConfigJson(currentValues.systemPrompt, {}),
      } satisfies CreateAgentInput)
      onCreated?.(created.id)
    }
    catch (err) {
      dispatch({ type: 'save/error', error: err instanceof Error ? err.message : String(err) })
    }
    finally {
      dispatch({ type: 'create/saving', value: false })
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
    dispatch({ type: 'avatar/spin' })
  }, [form])

  return {
    isCreate,
    form,
    draft,
    enabledProfiles,
    avatarSpinKey,
    avatarUrl: buildAvatarUrl(draft.avatarStyle, draft.avatarSeed),
    saveState,
    createSaving,
    saveError,
    createDisabled: !isDirty || createSaving || !draft.name.trim() || !draft.agentProfileId,
    handleCreate,
    handleDelete,
    shuffleAvatar,
  }
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
  const owner = useAgentDetailOwner({ agent, profiles, onCreated, onDeleted })

  return (
    <FormProvider {...owner.form}>
      <div className="flex flex-col gap-0" data-testid={agent ? `agent-detail-${agent.id}` : 'agent-create'}>
        <AgentDetailHeader
          isCreate={owner.isCreate}
          saveState={owner.saveState}
          agentName={agent?.name}
          onBack={onBack}
          onDelete={owner.handleDelete}
        />

        <AgentIdentitySection
          draft={owner.draft}
          enabledProfiles={owner.enabledProfiles}
          avatarUrl={owner.avatarUrl}
          avatarSpinKey={owner.avatarSpinKey}
          onShuffleAvatar={owner.shuffleAvatar}
        />

        <SettingsDivider />
        <AgentSystemPromptSection />

        {owner.isCreate
          ? (
              <>
                <SettingsDivider />
                <AgentCreateActions
                  createSaving={owner.createSaving}
                  createDisabled={owner.createDisabled}
                  saveError={owner.saveError}
                  onCancel={onBack}
                  onCreate={owner.handleCreate}
                />
              </>
            )
          : agent && (
              <>
                <SettingsDivider />
                <AgentSkillsSection agentId={agent.id} />
              </>
            )}

        {owner.saveError && !owner.isCreate && (
          <p className="mt-2 text-[11px] text-destructive">{owner.saveError}</p>
        )}
      </div>
    </FormProvider>
  )
}
