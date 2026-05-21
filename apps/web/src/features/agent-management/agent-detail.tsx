import { ArrowLeftIcon, CheckIcon, DicesIcon, XIcon } from 'lucide-react'
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
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import { useAgentModelMap } from '~/features/agent-runtime/use-agent-models'
import { useAgents } from '~/features/agent-runtime/use-agents'
import { filterThinkingOptionsForModel, selectSupportedThinkingValue, THINKING_EFFORTS } from '~/features/composer-toolbar/constants'
import { ProviderModelPicker } from '~/features/composer-toolbar/provider-model-picker'
import { CurrentProviderModelList, type ModelsByProfileId, type ThinkingOption } from '~/features/composer-toolbar/provider-model-menu'
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

const AGENT_THINKING_OPTIONS: Array<ThinkingOption<ThinkingEffort>> = THINKING_EFFORTS.map(option => ({
  ...option,
  value: option.value ?? 'auto',
}))

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
  claudeAgentHaikuModel: string
  claudeAgentSonnetModel: string
  claudeAgentOpusModel: string
  cliTuiPreset: string
  cliTuiExecutable: string
  cliTuiArguments: string
  cliTuiEnvText: string
}

interface ClaudeAgentModelAliases {
  haiku?: string
  sonnet?: string
  opus?: string
}

type ClaudeAgentModelField = 'claudeAgentHaikuModel' | 'claudeAgentSonnetModel' | 'claudeAgentOpusModel'

const CLAUDE_AGENT_ALIAS_LABELS: Record<ClaudeAgentModelField, string> = {
  claudeAgentHaikuModel: 'haiku alias',
  claudeAgentSonnetModel: 'sonnet alias',
  claudeAgentOpusModel: 'opus alias',
}

interface AgentDetailUiState {
  avatarSpinKey: number
  saveState: SaveState
  createSaving: boolean
  saveError: string | null
}

interface CliEnvParseResult {
  env: Record<string, string> | undefined
  invalidLineNumbers: number[]
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

export function parseCliEnvText(text: string): CliEnvParseResult {
  const entries: Array<readonly [string, string]> = []
  const invalidLineNumbers: number[] = []

  text.split('\n').forEach((rawLine, index) => {
    const line = rawLine.trim()
    if (!line) {
      return
    }
    const eqIndex = line.indexOf('=')
    if (eqIndex <= 0) {
      invalidLineNumbers.push(index + 1)
      return
    }
    const key = line.slice(0, eqIndex).trim()
    if (!key) {
      invalidLineNumbers.push(index + 1)
      return
    }
    entries.push([key, line.slice(eqIndex + 1)] as const)
  })

  return {
    env: entries.length > 0 ? Object.fromEntries(entries) : undefined,
    invalidLineNumbers,
  }
}

function stringifyEnvText(text: string): Record<string, string> | undefined {
  return parseCliEnvText(text).env
}

export function getAgentCreateDisabledReason(input: {
  draft: Pick<AgentDetailDraft, 'name' | 'runtimeKind' | 'agentProfileId' | 'cliTuiExecutable'>
  isDirty: boolean
  createSaving: boolean
}): string | null {
  if (!input.draft.name.trim()) {
    return 'Name is required.'
  }
  if (input.draft.runtimeKind === 'cli-tui' && !input.draft.cliTuiExecutable.trim()) {
    return 'CLI TUI agents need an executable command.'
  }
  if (input.draft.runtimeKind !== 'cli-tui' && !input.draft.agentProfileId) {
    return 'Select a provider profile before creating.'
  }
  if (input.createSaving) {
    return 'Creating agent...'
  }
  if (!input.isDirty) {
    return 'Make a change before creating.'
  }
  return null
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

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function trimToValue(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function parseConfigJson(configJson?: string | null): {
  systemPrompt: string
  cliTui: CliTuiLaunchConfig | null
  claudeAgentModelAliases: ClaudeAgentModelAliases
  baseConfig: Record<string, unknown>
} {
  try {
    const parsed = JSON.parse(configJson ?? '{}') as AgentRuntimeConfig
    const systemPrompt = typeof parsed.systemPrompt === 'string' ? parsed.systemPrompt : ''
    const cliTui = parsed.cliTui && typeof parsed.cliTui.executable === 'string' ? parsed.cliTui : null
    const claudeAgent = readRecord(parsed.claudeAgent)
    const modelAliases = readRecord(claudeAgent.modelAliases)
    const { systemPrompt: _sp, skills: _sk, cliTui: _cliTui, ...baseConfig } = parsed
    return {
      systemPrompt,
      cliTui,
      claudeAgentModelAliases: {
        haiku: readString(modelAliases.haiku),
        sonnet: readString(modelAliases.sonnet),
        opus: readString(modelAliases.opus),
      },
      baseConfig,
    }
  }
  catch {
    return { systemPrompt: '', cliTui: null, claudeAgentModelAliases: {}, baseConfig: {} }
  }
}

function writeClaudeAgentConfig(config: Record<string, unknown>, input: {
  runtimeKind: RuntimeKind
  haikuModel: string
  sonnetModel: string
  opusModel: string
}): void {
  const existing = { ...readRecord(config.claudeAgent) }
  const aliases: ClaudeAgentModelAliases = {}
  const haiku = trimToValue(input.haikuModel)
  const sonnet = trimToValue(input.sonnetModel)
  const opus = trimToValue(input.opusModel)

  if (haiku) {
    aliases.haiku = haiku
  }
  if (sonnet) {
    aliases.sonnet = sonnet
  }
  if (opus) {
    aliases.opus = opus
  }

  if (input.runtimeKind === 'claude-agent' && Object.keys(aliases).length > 0) {
    existing.modelAliases = aliases
  }
  else if (input.runtimeKind === 'claude-agent') {
    delete existing.modelAliases
  }

  if (Object.keys(existing).length > 0) {
    config.claudeAgent = existing
    return
  }

  delete config.claudeAgent
}

export function stringifyConfigJson(input: {
  systemPrompt: string
  claudeAgentHaikuModel: string
  claudeAgentSonnetModel: string
  claudeAgentOpusModel: string
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
  writeClaudeAgentConfig(config, {
    runtimeKind: input.runtimeKind,
    haikuModel: input.claudeAgentHaikuModel,
    sonnetModel: input.claudeAgentSonnetModel,
    opusModel: input.claudeAgentOpusModel,
  })
  if (input.runtimeKind === 'cli-tui') {
    const cliEnv = stringifyEnvText(input.cliTuiEnvText)
    config.cliTui = {
      preset: input.cliTuiPreset,
      executable: input.cliTuiExecutable.trim(),
      args: input.cliTuiArguments.trim() ? input.cliTuiArguments.split(WHITESPACE_RE).filter(Boolean) : [],
      ...(cliEnv ? { env: cliEnv } : {}),
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
    claudeAgentHaikuModel: initialConfig.claudeAgentModelAliases.haiku ?? '',
    claudeAgentSonnetModel: initialConfig.claudeAgentModelAliases.sonnet ?? '',
    claudeAgentOpusModel: initialConfig.claudeAgentModelAliases.opus ?? '',
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

function ClaudeAgentAliasModelPicker({
  field,
  mainModelId,
  pickerProfiles,
  profileId,
  modelsByProfileId,
  loadingProfileIds,
  testId,
}: {
  field: ClaudeAgentModelField
  mainModelId: string | null
  pickerProfiles: AgentProfile[]
  profileId: string | null
  modelsByProfileId: ModelsByProfileId
  loadingProfileIds: Set<string>
  testId: string
}) {
  const form = useFormContext<AgentDetailFormValues>()
  const value = useWatch({ control: form.control, name: field }) ?? ''
  const models = profileId ? modelsByProfileId[profileId] ?? [] : []
  const selectedModel = models.find(model => model.id === value) ?? null
  const mainModel = models.find(model => model.id === mainModelId) ?? null
  const isLoadingModels = profileId ? loadingProfileIds.has(profileId) : false
  const mainModelLabel = mainModel?.label ?? mainModelId ?? 'main model'
  const label = selectedModel?.label ?? (value || mainModelLabel)
  const aliasLabel = CLAUDE_AGENT_ALIAS_LABELS[field]
  const reusedMainModelRow = !value && mainModelId && pickerProfiles.length > 0
    ? (
        <MenuItem disabled className="items-start">
          <span className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[11px] text-muted-foreground/60">Reusing main model</span>
            <span className="max-w-48 truncate text-[12px] text-foreground/75">{mainModelLabel}</span>
          </div>
        </MenuItem>
      )
    : null

  return (
    <div className="flex items-center gap-1.5">
      <Menu>
        <MenuTrigger render={<Button variant="ghost" size="xs" data-testid={testId} />}>
          <span className={cn('max-w-40 truncate', !value && 'text-muted-foreground/80')}>
            {label}
          </span>
          {!value && (
            <span className="text-muted-foreground/45">
              (reused)
            </span>
          )}
        </MenuTrigger>
        <MenuPopup side="bottom" align="end">
          {pickerProfiles.length === 0 && (
            <MenuItem disabled>Select a provider profile first</MenuItem>
          )}
          {pickerProfiles.length > 0 && (
            <CurrentProviderModelList
              models={models}
              selectedModelId={value || null}
              thinkingValue={null}
              getThinkingOptionsForModel={() => [{ value: null, label: 'Auto', description: '' }]}
              isLoadingModels={isLoadingModels}
              leadingContent={reusedMainModelRow}
              onSelectModel={modelId => form.setValue(field, modelId, { shouldDirty: true })}
              onSelectThinking={() => {}}
            />
          )}
        </MenuPopup>
      </Menu>
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Reuse main model for ${aliasLabel}`}
          onClick={() => form.setValue(field, '', { shouldDirty: true })}
          className="text-muted-foreground/60 hover:text-foreground"
        >
          <XIcon className="size-3" />
        </Button>
      )}
    </div>
  )
}

function ClaudeAgentSdkSettings({
  profiles,
  profileId,
  mainModelId,
}: {
  profiles: AgentProfile[]
  profileId: string | null
  mainModelId: string | null
}) {
  const selectedProfile = profileId ? profiles.find(profile => profile.id === profileId) ?? null : null
  const pickerProfiles = useMemo(() => selectedProfile ? [selectedProfile] : [], [selectedProfile])
  const { modelsByProfileId, loadingProfileIds } = useAgentModelMap(pickerProfiles)

  return (
    <>
      <SettingsDivider />
      <div className="flex flex-col gap-0">
        <div className="mb-2">
          <h5 className="font-heading text-[13px] font-medium text-foreground">
            Claude Agent SDK
          </h5>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
            Configure the models used when this agent asks the SDK for model aliases.
          </p>
        </div>

        <SettingsRow label="Haiku alias" description="Used when the SDK requests the haiku alias.">
          <ClaudeAgentAliasModelPicker
            field="claudeAgentHaikuModel"
            pickerProfiles={pickerProfiles}
            profileId={profileId}
            modelsByProfileId={modelsByProfileId}
            loadingProfileIds={loadingProfileIds}
            mainModelId={mainModelId}
            testId="agent-claude-haiku-model"
          />
        </SettingsRow>

        <SettingsDivider />
        <SettingsRow label="Sonnet alias" description="Used when the SDK requests the sonnet alias.">
          <ClaudeAgentAliasModelPicker
            field="claudeAgentSonnetModel"
            pickerProfiles={pickerProfiles}
            profileId={profileId}
            modelsByProfileId={modelsByProfileId}
            loadingProfileIds={loadingProfileIds}
            mainModelId={mainModelId}
            testId="agent-claude-sonnet-model"
          />
        </SettingsRow>

        <SettingsDivider />
        <SettingsRow label="Opus alias" description="Used when the SDK requests the opus alias.">
          <ClaudeAgentAliasModelPicker
            field="claudeAgentOpusModel"
            pickerProfiles={pickerProfiles}
            profileId={profileId}
            modelsByProfileId={modelsByProfileId}
            loadingProfileIds={loadingProfileIds}
            mainModelId={mainModelId}
            testId="agent-claude-opus-model"
          />
        </SettingsRow>
      </div>
    </>
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
  claudeAgentHaikuModel: string
  claudeAgentSonnetModel: string
  claudeAgentOpusModel: string
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
  const cliEnvParseResult = useMemo(() => parseCliEnvText(draft.cliTuiEnvText), [draft.cliTuiEnvText])
  const invalidEnvLineSummary = cliEnvParseResult.invalidLineNumbers.join(', ')

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
                <div className="flex w-full flex-col gap-1.5">
                  <textarea
                    {...form.register('cliTuiEnvText')}
                    rows={4}
                    data-testid="agent-cli-env"
                    aria-invalid={cliEnvParseResult.invalidLineNumbers.length > 0}
                    placeholder={'ANTHROPIC_API_KEY=...\nNO_COLOR=1'}
                    className={cn(
                      'w-full resize-none rounded-md bg-foreground/4 px-3 py-2.5 text-[12px] outline-none',
                      'text-foreground placeholder:text-muted-foreground/30',
                      'transition-colors focus:bg-foreground/5',
                      cliEnvParseResult.invalidLineNumbers.length > 0 && 'bg-destructive/5 ring-1 ring-destructive/25 focus:bg-destructive/5',
                    )}
                  />
                  {cliEnvParseResult.invalidLineNumbers.length > 0 && (
                    <p className="text-[11px] leading-snug text-destructive/85" data-testid="agent-cli-env-warning">
                      Ignoring invalid env
                      {' '}
                      {cliEnvParseResult.invalidLineNumbers.length === 1 ? 'line' : 'lines'}
                      {' '}
                      {invalidEnvLineSummary}
                      . Use KEY=value.
                    </p>
                  )}
                </div>
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

              {draft.runtimeKind === 'claude-agent' && (
                <ClaudeAgentSdkSettings
                  profiles={enabledProfiles}
                  profileId={draft.agentProfileId}
                  mainModelId={draft.modelId}
                />
              )}
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
  createDisabledReason,
  saveError,
  onCancel,
  onCreate,
}: {
  createSaving: boolean
  createDisabled: boolean
  createDisabledReason: string | null
  saveError: string | null
  onCancel?: () => void
  onCreate: () => void
}) {
  return (
    <div className="flex items-center justify-end gap-2 py-4">
      {saveError && <p className="mr-auto text-[11px] text-destructive">{saveError}</p>}
      {!saveError && createDisabledReason && (
        <p className="mr-auto text-[11px] text-muted-foreground" data-testid="agent-create-disabled-reason">
          {createDisabledReason}
        </p>
      )}
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
    claudeAgentHaikuModel: watchedValues.claudeAgentHaikuModel ?? '',
    claudeAgentSonnetModel: watchedValues.claudeAgentSonnetModel ?? '',
    claudeAgentOpusModel: watchedValues.claudeAgentOpusModel ?? '',
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
  const createDisabledReason = getAgentCreateDisabledReason({ draft, isDirty, createSaving })
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
        claudeAgentHaikuModel: currentValues.claudeAgentHaikuModel,
        claudeAgentSonnetModel: currentValues.claudeAgentSonnetModel,
        claudeAgentOpusModel: currentValues.claudeAgentOpusModel,
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
          claudeAgentHaikuModel: currentValues.claudeAgentHaikuModel,
          claudeAgentSonnetModel: currentValues.claudeAgentSonnetModel,
          claudeAgentOpusModel: currentValues.claudeAgentOpusModel,
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
    createDisabled: createDisabledReason !== null,
    createDisabledReason,
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
                  createDisabledReason={owner.createDisabledReason}
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
