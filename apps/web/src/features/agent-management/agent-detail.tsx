// Input: useAgents, useAgentProfiles, useAgentModelMap hooks; Agent/AgentProfile/CreateAgentInput types; SkillManager; AlertDialog; motion/react
// Output: AgentDetailPage — profile-card identity zone + auto-saving config + private skills. Create and edit unified.
// Position: Rendered by AgentList in both create and edit modes

import { ArrowLeftIcon, CheckIcon, DicesIcon } from 'lucide-react'
import { m } from 'motion/react'
import { Select as RadixSelect } from 'radix-ui'
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
import { useAgentModelMap } from '~/features/agent-runtime/use-agent-models'
import { useAgents } from '~/features/agent-runtime/use-agents'
import { filterThinkingOptionsForModel, selectSupportedThinkingValue } from '~/features/composer-toolbar/constants'
import { ProviderModelPicker } from '~/features/composer-toolbar/provider-model-picker'
import type { ThinkingOption } from '~/features/composer-toolbar/provider-model-menu'
import { SkillManager } from '~/features/skills'
import { cn } from '~/lib/cn'
import type { Agent, AgentProfile, AgentRuntimeConfig, CliTuiLaunchConfig, CreateAgentInput, ModelDescriptor, RuntimeKind } from '~/lib/types'

import { SettingsDivider, SettingsRow } from '../settings/settings-row'
import { buildAvatarUrl } from './avatar-url'
import { PROVIDER_ICONS } from './provider-icons'

// ── Constants ─────────────────────────────────────────────────────────────────

const WHITESPACE_RE = /\s+/

// ── Runtime options ───────────────────────────────────────────────────────────

const ClaudeIcon = PROVIDER_ICONS['claude-agent']!
const _ClaudeCodeIcon = PROVIDER_ICONS['claude-cli']!
// eslint-disable-next-line dot-notation
const CodexIcon = PROVIDER_ICONS['codex']!

const RUNTIME_OPTIONS: { value: RuntimeKind, label: string, description: string, icon: React.ReactNode }[] = [
  {
    value: 'standard',
    label: 'Standard',
    description: 'Direct model calls via the configured provider profile',
    icon: <span className="flex size-5 items-center justify-center rounded bg-foreground/8 text-foreground/60 text-[9px] font-bold leading-none">AI</span>,
  },
  {
    value: 'claude-agent',
    label: 'Claude Agent',
    description: 'Agentic loop powered by Claude with tool-use support',
    icon: <ClaudeIcon className="size-4 text-[#D97757]" />,
  },
  {
    value: 'codex',
    label: 'Codex',
    description: 'OpenAI Codex CLI for code-focused autonomous tasks',
    icon: <CodexIcon className="size-4 text-foreground/70" />,
  },
  {
    value: 'cli-tui',
    label: 'CLI TUI',
    description: 'Terminal-native runtime launched from an explicit command',
    icon: <span className="flex size-5 items-center justify-center rounded bg-foreground/8 text-foreground/70 text-[9px] font-semibold leading-none">&gt;_</span>,
  },
]

const CLI_TUI_PRESETS = [
  { id: 'claude-code', label: 'Claude Code', executable: 'claude' },
  { id: 'codex', label: 'Codex', executable: 'codex' },
  { id: 'custom', label: 'Custom', executable: '' },
] as const

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

const AGENT_THINKING_OPTIONS: Array<ThinkingOption<ThinkingEffort>> = [
  { value: 'auto', label: 'Auto', description: 'Let the runtime choose an appropriate reasoning budget' },
  { value: 'low', label: 'Low', description: 'Fast responses with light reasoning' },
  { value: 'medium', label: 'Medium', description: 'Balanced reasoning for everyday work' },
  { value: 'high', label: 'High', description: 'Deeper reasoning for complex work' },
]

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
  cliTuiPreset: string
  cliTuiExecutable: string
  cliTuiArguments: string
  cliTuiEnvText: string
}

interface AgentDetailUiState {
  avatarSpinKey: number
  saveState: SaveState
  createSaving: boolean
  saveError: string | null
}

type AgentDetailUiAction
  = | { type: 'reset' }
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

function generateSeed(): string {
  return Math.random().toString(36).slice(2, 10)
}

function parseEnvText(env?: Record<string, string>): string {
  return Object.entries(env ?? {}).map(([key, value]) => `${key}=${value}`).join('\n')
}

function stringifyEnvText(text: string): Record<string, string> | undefined {
  const entries = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map((line) => {
      const eqIndex = line.indexOf('=')
      if (eqIndex <= 0) {
        return null
      }
      return [line.slice(0, eqIndex).trim(), line.slice(eqIndex + 1)] as const
    })
    .filter((entry): entry is readonly [string, string] => !!entry && !!entry[0])

  if (entries.length === 0) {
    return undefined
  }
  return Object.fromEntries(entries)
}

function inferCliPreset(launch: CliTuiLaunchConfig | null): string {
  if (!launch) {
    return 'claude-code'
  }
  if (launch.preset) {
    return launch.preset
  }
  if (launch.executable === 'claude') {
    return 'claude-code'
  }
  if (launch.executable === 'codex') {
    return 'codex'
  }
  return 'custom'
}

function parseConfigJson(configJson?: string | null): { systemPrompt: string, cliTui: CliTuiLaunchConfig | null, baseConfig: Record<string, unknown> } {
  try {
    const parsed = JSON.parse(configJson ?? '{}') as AgentRuntimeConfig
    const systemPrompt = typeof parsed.systemPrompt === 'string' ? parsed.systemPrompt : ''
    const cliTui = parsed.cliTui && typeof parsed.cliTui.executable === 'string' ? parsed.cliTui : null
    const { systemPrompt: _sp, skills: _sk, cliTui: _cliTui, ...baseConfig } = parsed
    return { systemPrompt, cliTui, baseConfig }
  }
  catch {
    return { systemPrompt: '', cliTui: null, baseConfig: {} }
  }
}

function stringifyConfigJson(input: {
  systemPrompt: string
  baseConfig: Record<string, unknown>
  runtimeKind: RuntimeKind
  cliTuiPreset: string
  cliTuiExecutable: string
  cliTuiArguments: string
  cliTuiEnvText: string
}): string {
  const config: Record<string, unknown> = { ...input.baseConfig }
  if (input.systemPrompt.trim()) {
    config.systemPrompt = input.systemPrompt
  }
  if (input.runtimeKind === 'cli-tui') {
    config.cliTui = {
      preset: input.cliTuiPreset,
      executable: input.cliTuiExecutable.trim(),
      args: input.cliTuiArguments.trim() ? input.cliTuiArguments.split(WHITESPACE_RE).filter(Boolean) : [],
      ...(stringifyEnvText(input.cliTuiEnvText) ? { env: stringifyEnvText(input.cliTuiEnvText) } : {}),
    }
  }
  return JSON.stringify(config)
}

function getAgentDetailFormValues(agent: Agent | undefined, enabledProfiles: AgentProfile[]): AgentDetailFormValues {
  const initialConfig = parseConfigJson(agent?.configJson)
  const cliTuiPreset = inferCliPreset(initialConfig.cliTui)
  const presetExecutable = CLI_TUI_PRESETS.find(preset => preset.id === cliTuiPreset)?.executable ?? ''
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
    cliTuiPreset,
    cliTuiExecutable: initialConfig.cliTui?.executable ?? presetExecutable,
    cliTuiArguments: initialConfig.cliTui?.args?.join(' ') ?? '',
    cliTuiEnvText: parseEnvText(initialConfig.cliTui?.env),
  }
}

// ── Provider / Model Picker ───────────────────────────────────────────────────

function AgentProviderModelPicker({
  profiles,
  profileId,
  modelId,
  thinkingEffort,
}: {
  profiles: AgentProfile[]
  profileId: string | null
  modelId: string | null
  thinkingEffort: ThinkingEffort
}) {
  const form = useFormContext<AgentDetailFormValues>()
  const { modelsByProfileId, loadingProfileIds } = useAgentModelMap(profiles)
  const models = profileId ? modelsByProfileId[profileId] ?? [] : []
  const selectedModel = models.find(model => model.id === modelId) ?? null
  const isLoadingModels = profileId ? loadingProfileIds.has(profileId) : false

  const selectThinkingForModel = (model: ModelDescriptor | null): ThinkingEffort =>
    selectSupportedThinkingValue(model, AGENT_THINKING_OPTIONS, thinkingEffort, 'auto')

  const applyDefaultModel = useEffectEvent((nextModel: ModelDescriptor) => {
    form.setValue('modelId', nextModel.id, { shouldDirty: false })
    form.setValue('thinkingEffort', selectThinkingForModel(nextModel), { shouldDirty: false })
  })

  useEffect(() => {
    if (!profileId || modelId !== null || models.length === 0) {
      return
    }
    applyDefaultModel(models[0]!)
  }, [profileId, modelId, models])

  return (
    <ProviderModelPicker
      profiles={profiles}
      selectedProfileId={profileId}
      selectedModelId={modelId}
      selectedModel={selectedModel}
      modelsByProfileId={modelsByProfileId}
      loadingProfileIds={loadingProfileIds}
      thinkingValue={thinkingEffort}
      thinkingOptions={AGENT_THINKING_OPTIONS}
      isLoadingSelectedModels={isLoadingModels}
      emptyProfilesLabel="No provider profiles configured"
      emptySelectionLabel="Select a profile"
      menuSide="bottom"
      menuAlign="end"
      triggerTestId="agent-provider-model-selector"
      getThinkingOptionsForModel={model => filterThinkingOptionsForModel(model, AGENT_THINKING_OPTIONS)}
      onSelectProfile={(nextProfileId) => {
        const nextModel = (modelsByProfileId[nextProfileId] ?? [])[0] ?? null
        form.setValue('agentProfileId', nextProfileId, { shouldDirty: true })
        form.setValue('modelId', nextModel?.id ?? null, { shouldDirty: true })
        form.setValue('thinkingEffort', selectThinkingForModel(nextModel), { shouldDirty: true })
      }}
      onSelectModel={(nextModelId, nextProfileId) => {
        const nextModel = nextModelId
          ? (modelsByProfileId[nextProfileId] ?? []).find(model => model.id === nextModelId) ?? null
          : null
        form.setValue('agentProfileId', nextProfileId, { shouldDirty: true })
        form.setValue('modelId', nextModelId, { shouldDirty: true })
        form.setValue('thinkingEffort', selectThinkingForModel(nextModel), { shouldDirty: true })
      }}
      onSelectThinking={nextThinking => form.setValue('thinkingEffort', nextThinking, { shouldDirty: true })}
    />
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
  cliTuiPreset: string
  cliTuiExecutable: string
  cliTuiArguments: string
  cliTuiEnvText: string
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
  onBack?: () => void
  onDelete: () => void
}) {
  return (
    <div className={cn('flex items-center justify-between', onBack ? 'mb-6' : 'mb-4')}>
      {onBack
        ? (
          <button
            type="button"
            onClick={onBack}
            data-testid="agent-detail-back"
            className="flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" />
            Agents
          </button>
        )
        : <div />}

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
    <div className="flex flex-col gap-0">
      {/* Avatar + name hero row */}
      <div className="flex items-start gap-4 py-3">
        <div className="flex shrink-0 flex-col items-center gap-1">
          <m.button
            type="button"
            onClick={onShuffleAvatar}
            data-testid="agent-avatar-preview"
            className="group relative size-16 cursor-pointer overflow-hidden rounded-2xl bg-foreground/5"
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
              className="h-5 w-16 border-0 bg-transparent px-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground"
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

        <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1">
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
      </div>

      {/* Runtime row */}
      <SettingsDivider />
      <SettingsRow label="Runtime" description="Which execution mode the agent runs in">
        <Select
          value={draft.runtimeKind}
          onValueChange={value => form.setValue('runtimeKind', value as RuntimeKind, { shouldDirty: true })}
        >
          <SelectTrigger size="sm" className="h-8 w-48 text-[12.5px]" data-testid="agent-runtime-select">
          <div className="flex items-center gap-2">
          {(() => {
              const opt = RUNTIME_OPTIONS.find(o => o.value === draft.runtimeKind)
              return opt
                ? (
                  <span className="">
                    {opt.icon}
                  </span>
                )
                : <span className="text-muted-foreground">Select runtime…</span>
            })()}
            <SelectValue />
          </div>
          </SelectTrigger>
          <SelectContent className="w-64">
            {RUNTIME_OPTIONS.map(opt => (
              <RadixSelect.Item
                key={opt.value}
                value={opt.value}
                className={cn(
                  'relative flex w-full cursor-default items-start gap-2.5 rounded-md py-2 pr-8 pl-2 text-sm outline-hidden select-none',
                  'focus:bg-accent focus:text-accent-foreground',
                  'data-disabled:pointer-events-none data-disabled:opacity-50',
                )}
              >
                <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
                  <RadixSelect.ItemIndicator>
                    <CheckIcon className="pointer-events-none size-3" />
                  </RadixSelect.ItemIndicator>
                </span>
                <span className="mt-0.5 shrink-0">{opt.icon}</span>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <RadixSelect.ItemText className="text-[12.5px] font-medium">
                    {opt.label}
                  </RadixSelect.ItemText>
                  <span className="text-[11px] text-muted-foreground leading-snug">
                    {opt.description}
                  </span>
                </div>
              </RadixSelect.Item>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      {draft.runtimeKind === 'cli-tui'
        ? (
            <>
              <SettingsDivider />
              <SettingsRow label="Launch preset" description="A named starting point for the terminal runtime">
                <Select
                  value={draft.cliTuiPreset}
                  onValueChange={(value) => {
                    form.setValue('cliTuiPreset', value, { shouldDirty: true })
                    const presetExecutable = CLI_TUI_PRESETS.find(preset => preset.id === value)?.executable ?? ''
                    if (value !== 'custom') {
                      form.setValue('cliTuiExecutable', presetExecutable, { shouldDirty: true })
                    }
                  }}
                >
                  <SelectTrigger size="sm" className="h-8 w-48 text-[12.5px]" data-testid="agent-cli-preset-select">
                    <SelectValue placeholder="Select a preset…" />
                  </SelectTrigger>
                  <SelectContent>
                    {CLI_TUI_PRESETS.map(preset => (
                      <SelectItem key={preset.id} value={preset.id} className="text-xs">
                        {preset.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingsRow>

              <SettingsDivider />
              <SettingsRow label="Executable" description="The command Cradle will launch for this terminal runtime">
                <input
                  type="text"
                  {...form.register('cliTuiExecutable')}
                  data-testid="agent-cli-executable"
                  placeholder="claude"
                  className="h-8 w-56 rounded-md bg-foreground/4 px-3 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/35"
                />
              </SettingsRow>

              <SettingsDivider />
              <SettingsRow label="Arguments" description="Optional CLI arguments appended to the executable">
                <input
                  type="text"
                  {...form.register('cliTuiArguments')}
                  data-testid="agent-cli-arguments"
                  placeholder="--dangerously-skip-permissions"
                  className="h-8 w-72 rounded-md bg-foreground/4 px-3 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/35"
                />
              </SettingsRow>

              <SettingsDivider />
              <SettingsRow label="Environment" description="Optional KEY=value lines injected into the launched process" vertical>
                <textarea
                  {...form.register('cliTuiEnvText')}
                  rows={4}
                  data-testid="agent-cli-env"
                  placeholder={'ANTHROPIC_API_KEY=...\nNO_COLOR=1'}
                  className={cn(
                    'w-full resize-none rounded-md bg-foreground/4 px-3 py-2.5 text-[12px] outline-none',
                    'text-foreground placeholder:text-muted-foreground/30',
                    'transition-colors focus:bg-foreground/5',
                  )}
                />
              </SettingsRow>
            </>
          )
        : (
            <>
              <SettingsDivider />
              <SettingsRow label="Model" description="Choose provider profile, model, and thinking effort">
                <AgentProviderModelPicker
                  profiles={enabledProfiles}
                  profileId={draft.agentProfileId}
                  modelId={draft.modelId}
                  thinkingEffort={draft.thinkingEffort}
                />
              </SettingsRow>
            </>
          )}
    </div>
  )
}

function AgentSystemPromptSection() {
  const form = useFormContext<AgentDetailFormValues>()

  return (
    <SettingsRow label="System Prompt" description="Optional instructions for this agent" vertical>
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
    </SettingsRow>
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
  onCancel?: () => void
  onCreate: () => void
}) {
  return (
    <div className="flex items-center justify-end gap-2 py-4">
      {saveError && <p className="mr-auto text-[11px] text-destructive">{saveError}</p>}
      {onCancel && (
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      )}
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
    cliTuiPreset: watchedValues.cliTuiPreset ?? 'claude-code',
    cliTuiExecutable: watchedValues.cliTuiExecutable ?? '',
    cliTuiArguments: watchedValues.cliTuiArguments ?? '',
    cliTuiEnvText: watchedValues.cliTuiEnvText ?? '',
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
    if (form.getValues('runtimeKind') === 'cli-tui') {
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
    const requiresProfile = currentValues.runtimeKind !== 'cli-tui'
    if (!currentValues.name.trim() || (requiresProfile && !currentValues.agentProfileId) || (!requiresProfile && !currentValues.cliTuiExecutable.trim())) {
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
      const configJson = stringifyConfigJson({
        systemPrompt: currentValues.systemPrompt,
        baseConfig: persistedConfig.baseConfig,
        runtimeKind: currentValues.runtimeKind,
        cliTuiPreset: currentValues.cliTuiPreset,
        cliTuiExecutable: currentValues.cliTuiExecutable,
        cliTuiArguments: currentValues.cliTuiArguments,
        cliTuiEnvText: currentValues.cliTuiEnvText,
      })
      await updateAgent.mutateAsync({
        id: agent.id,
        patch: {
          name: normalizedValues.name,
          description: normalizedValues.description || null,
          avatarStyle: currentValues.avatarStyle,
          avatarSeed: currentValues.avatarSeed,
          agentProfileId: currentValues.runtimeKind === 'cli-tui' ? null : currentValues.agentProfileId,
          modelId: currentValues.runtimeKind === 'cli-tui' ? null : currentValues.modelId,
          thinkingEffort: currentValues.runtimeKind === 'cli-tui' ? 'auto' : currentValues.thinkingEffort,
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
    const requiresProfile = currentValues.runtimeKind !== 'cli-tui'
    if (!currentValues.name.trim() || (requiresProfile && !currentValues.agentProfileId) || (!requiresProfile && !currentValues.cliTuiExecutable.trim())) {
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
        agentProfileId: currentValues.runtimeKind === 'cli-tui' ? null : currentValues.agentProfileId,
        modelId: currentValues.runtimeKind === 'cli-tui' ? null : currentValues.modelId,
        thinkingEffort: currentValues.runtimeKind === 'cli-tui' ? 'auto' : currentValues.thinkingEffort,
        runtimeKind: currentValues.runtimeKind,
        configJson: stringifyConfigJson({
          systemPrompt: currentValues.systemPrompt,
          baseConfig: {},
          runtimeKind: currentValues.runtimeKind,
          cliTuiPreset: currentValues.cliTuiPreset,
          cliTuiExecutable: currentValues.cliTuiExecutable,
          cliTuiArguments: currentValues.cliTuiArguments,
          cliTuiEnvText: currentValues.cliTuiEnvText,
        }),
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
    createDisabled: !isDirty || createSaving || !draft.name.trim() || (draft.runtimeKind === 'cli-tui' ? !draft.cliTuiExecutable.trim() : !draft.agentProfileId),
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
  onBack?: () => void
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
