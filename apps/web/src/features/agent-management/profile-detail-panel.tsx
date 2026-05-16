import {
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  Trash2Icon,
} from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import type { MutableRefObject, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { useForm, useWatch } from 'react-hook-form'

import {
  postProvidersHealthCheck,
  postProvidersModels,
  postSecrets,
  putProfilesById,
} from '~/api-gen/sdk.gen'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Separator } from '~/components/ui/separator'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'
import { getServerUrl } from '~/lib/electron'
import type { AgentProfile, ModelCapabilities, ModelDescriptor } from '~/lib/types'

import { SettingsDivider, SettingsRow } from '../settings/settings-row'
import { ALL_DISABLED_SENTINEL, parseConfig, presetForProfile, PROVIDER_KIND_LABELS, providerVisuals } from './agent-runtime-settings'
import { CustomModelsEditor } from './custom-models-editor'
import { ModelsPanel } from './models-panel'

type HealthStatus = 'unknown' | 'verifying' | 'connected' | 'failed'
type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

interface ProfileDetailFormValues {
  name: string
  apiKey: string
  baseUrl: string
  model: string
  command: string
  enabledModels: string[]
}

interface ProfileDetailUiState {
  availableModels: ModelDescriptor[]
  modelsLoading: boolean
  health: HealthStatus
  saveState: SaveState
  confirmRemove: boolean
}

type ProfileDetailUiAction = { type: 'reset' }
  | { type: 'models/loading' }
  | { type: 'models/loaded', models: ModelDescriptor[] }
  | { type: 'models/failed' }
  | { type: 'health/set', status: HealthStatus }
  | { type: 'save/set', state: SaveState }
  | { type: 'remove/set', open: boolean }

const INITIAL_UI_STATE: ProfileDetailUiState = {
  availableModels: [],
  modelsLoading: false,
  health: 'unknown',
  saveState: 'idle',
  confirmRemove: false,
}

function profileDetailUiReducer(state: ProfileDetailUiState, action: ProfileDetailUiAction): ProfileDetailUiState {
  switch (action.type) {
    case 'reset':
      return INITIAL_UI_STATE
    case 'models/loading':
      return { ...state, modelsLoading: true }
    case 'models/loaded':
      return { ...state, availableModels: action.models, modelsLoading: false }
    case 'models/failed':
      return { ...state, availableModels: [], modelsLoading: false }
    case 'health/set':
      return { ...state, health: action.status }
    case 'save/set':
      return { ...state, saveState: action.state }
    case 'remove/set':
      return { ...state, confirmRemove: action.open }
    default:
      return state
  }
}

function getInitialEnabledModels(parsed: Record<string, unknown>): string[] {
  const arr = parsed.enabledModels
  if (!Array.isArray(arr)) {
    return []
  }
  if (arr.length === 0) {
    return [ALL_DISABLED_SENTINEL]
  }
  return arr as string[]
}

function getProfileFormValues(profile: AgentProfile): ProfileDetailFormValues {
  const parsed = parseConfig(profile.configJson)
  return {
    name: profile.name,
    apiKey: '',
    baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : '',
    model: typeof parsed.model === 'string' ? parsed.model : '',
    command: typeof parsed.executable === 'string'
      ? parsed.executable
      : typeof parsed.cmd === 'string' ? parsed.cmd : '',
    enabledModels: getInitialEnabledModels(parsed),
  }
}

function buildProviderRequestBody(profile: AgentProfile) {
  return {
    providerKind: profile.providerKind,
    label: profile.name,
    config: parseConfig(profile.configJson),
    secretRef: profile.credentialRef ?? null,
    profileId: profile.id,
  }
}

function clearTimer(timerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>) {
  if (!timerRef.current) {
    return
  }

  clearTimeout(timerRef.current)
  timerRef.current = null
}

export function ProfileDetailPanel({
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
  const preset = presetForProfile(profile)
  const { Icon } = providerVisuals(preset.id)

  const parsed = useMemo(() => parseConfig(profile.configJson), [profile.configJson])
  const supportsModels = true
  const supportsCommand = false

  const form = useForm<ProfileDetailFormValues>({
    defaultValues: getProfileFormValues(profile),
  })
  const watchedValues = useWatch({ control: form.control }) as ProfileDetailFormValues
  const name = watchedValues.name ?? ''
  const apiKey = watchedValues.apiKey ?? ''
  const baseUrl = watchedValues.baseUrl ?? ''
  const model = watchedValues.model ?? ''
  const command = watchedValues.command ?? ''
  const enabledModels = useMemo(() => watchedValues.enabledModels ?? [], [watchedValues.enabledModels])

  const [uiState, dispatch] = useReducer(profileDetailUiReducer, INITIAL_UI_STATE)
  const {
    availableModels,
    modelsLoading,
    health,
    saveState,
    confirmRemove,
  } = uiState

  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const modelsRequestRef = useRef(0)
  const healthRequestRef = useRef(0)
  const saveRequestRef = useRef(0)

  const createProviderRequestBody = useCallback(() => buildProviderRequestBody(profile), [profile])
  const createProviderRequestBodyRef = useRef(createProviderRequestBody)
  createProviderRequestBodyRef.current = createProviderRequestBody

  const clearAutoSaveTimer = useCallback(() => {
    clearTimer(autoSaveTimerRef)
  }, [])

  const clearSavedClearTimer = useCallback(() => {
    clearTimer(savedClearTimerRef)
  }, [])

  useEffect(() => {
    return () => {
      clearAutoSaveTimer()
      clearSavedClearTimer()
    }
  }, [clearAutoSaveTimer, clearSavedClearTimer])

  // Reset state when switching profile
  const profileId = profile.id
  useEffect(() => {
    clearAutoSaveTimer()
    clearSavedClearTimer()
    modelsRequestRef.current += 1
    healthRequestRef.current += 1
    saveRequestRef.current += 1
    form.reset(getProfileFormValues(profile))
    dispatch({ type: 'reset' })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId])

  // Fetch available models (only when provider connection details change, not enabledModels)
  const modelFetchKey = useMemo(() => {
    const config = parseConfig(profile.configJson)
    return JSON.stringify({
      providerKind: profile.providerKind,
      baseUrl: config.baseUrl,
      credentialRef: profile.credentialRef,
    })
  }, [profile.providerKind, profile.configJson, profile.credentialRef])

  useEffect(() => {
    if (!supportsModels) {
      dispatch({ type: 'models/loaded', models: [] })
      return
    }

    const requestId = ++modelsRequestRef.current
    dispatch({ type: 'models/loading' })

    postProvidersModels({
      body: createProviderRequestBodyRef.current(),
    })
      .then(({ data }) => {
        if (requestId !== modelsRequestRef.current) {
          return
        }

        dispatch({ type: 'models/loaded', models: (data ?? []) as ModelDescriptor[] })
      })
      .catch(() => {
        if (requestId !== modelsRequestRef.current) {
          return
        }

        dispatch({ type: 'models/failed' })
      })
  }, [supportsModels, profile.id, modelFetchKey])

  // Health check on load + when key fields change
  const runHealthCheck = useCallback(async () => {
    const requestId = ++healthRequestRef.current
    dispatch({ type: 'health/set', status: 'verifying' })

    try {
      const { data } = await postProvidersHealthCheck({
        body: createProviderRequestBody(),
      })

      if (requestId !== healthRequestRef.current) {
        return
      }

      const hc = data as { ok: boolean } | null
      dispatch({ type: 'health/set', status: hc?.ok ? 'connected' : 'failed' })
    }
    catch {
      if (requestId !== healthRequestRef.current) {
        return
      }

      dispatch({ type: 'health/set', status: 'failed' })
    }
  }, [createProviderRequestBody])

  useEffect(() => {
    if (!profile.enabled) {
      healthRequestRef.current += 1
      dispatch({ type: 'health/set', status: 'unknown' })
      return
    }
    void runHealthCheck()
  }, [profile.enabled, runHealthCheck])

  // Build config json from current form values
  const buildConfigJson = useCallback((): string => {
    if (supportsModels) {
      const cleanEnabled = enabledModels.filter(id => id !== ALL_DISABLED_SENTINEL)
      const allDisabledNow = enabledModels[0] === ALL_DISABLED_SENTINEL
      return JSON.stringify({
        baseUrl,
        model: model || undefined,
        enabledModels: cleanEnabled.length > 0
          ? cleanEnabled
          : allDisabledNow
            ? []
            : undefined,
      })
    }
    return profile.configJson
  }, [profile.providerKind, profile.configJson, parsed, supportsModels, baseUrl, model, enabledModels, command])

  const doSave = useCallback(async () => {
    const currentValues = form.getValues()
    const requestId = ++saveRequestRef.current
    dispatch({ type: 'save/set', state: 'saving' })

    try {
      let credentialRef = profile.credentialRef ?? null
      if (currentValues.apiKey && supportsModels) {
        const { data: meta } = await postSecrets({
          body: { kind: profile.providerKind, label: currentValues.name, secret: currentValues.apiKey } as unknown as never,
        })
        credentialRef = (meta as Record<string, unknown>)?.id as string ?? credentialRef
      }

      await putProfilesById({
        path: { id: profile.id },
        body: {
          name: currentValues.name,
          providerKind: profile.providerKind,
          enabled: profile.enabled,
          config: parseConfig(buildConfigJson()),
          credentialRef,
        },
      })

      if (requestId !== saveRequestRef.current) {
        return
      }

      dispatch({ type: 'save/set', state: 'saved' })
      form.reset({
        ...currentValues,
        apiKey: '',
      })
      clearSavedClearTimer()
      savedClearTimerRef.current = setTimeout(() => {
        if (requestId === saveRequestRef.current) {
          dispatch({ type: 'save/set', state: 'idle' })
        }
      }, 1600)
      onSaved()
    }
    catch (err) {
      if (requestId !== saveRequestRef.current) {
        return
      }

      dispatch({ type: 'save/set', state: 'error' })
      console.error('[ProfileDetailPanel] save failed', err)
    }
  }, [clearSavedClearTimer, form, profile, supportsModels, buildConfigJson, onSaved])

  const watchedSignature = useMemo(() => JSON.stringify({
    name,
    apiKey,
    baseUrl,
    model,
    command,
    enabledModels,
  }), [name, apiKey, baseUrl, model, command, enabledModels])

  // Auto-save with debounce — but skip the very first run after switching profiles
  useEffect(() => {
    if (!form.formState.isDirty || saveState === 'saving') {
      return
    }

    dispatch({ type: 'save/set', state: 'pending' })
    clearAutoSaveTimer()
    const timeoutId = setTimeout(() => {
      void doSave()
    }, 1200)

    autoSaveTimerRef.current = timeoutId

    return () => {
      clearTimeout(timeoutId)
      if (autoSaveTimerRef.current === timeoutId) {
        autoSaveTimerRef.current = null
      }
    }
  }, [watchedSignature, doSave, form.formState.isDirty, saveState, clearAutoSaveTimer])

  const kindLabel = PROVIDER_KIND_LABELS[profile.providerKind]

  return (
    <div data-testid="provider-detail-panel" className="flex flex-col gap-2">
      <ProfileDetailHeader
        profile={profile}
        kindLabel={kindLabel}
        icon={<Icon className="mt-1 size-6 shrink-0 text-foreground/80" />}
        health={health}
        saveState={saveState}
        onRefreshHealth={() => void runHealthCheck()}
        onToggle={onToggle}
        onOpenRemove={() => dispatch({ type: 'remove/set', open: true })}
      />

      {/* Configuration */}
      <div className="flex flex-col">
        <ProfileGeneralSettings
          profile={profile}
          form={form}
          supportsModels={supportsModels}
          supportsCommand={supportsCommand}
        />

        {supportsModels && (
          <ProfileModelsSection
            loading={modelsLoading}
            models={availableModels}
            enabledModels={enabledModels}
            onChange={next => form.setValue('enabledModels', next, { shouldDirty: true })}
          />
        )}

        {supportsModels && (
          <ProfileCustomModelsSection profileId={profile.id} customModelsJson={profile.customModels} onSaved={onSaved} />
        )}
      </div>

      <RemoveProfileDialog
        open={confirmRemove}
        profileName={profile.name}
        onOpenChange={open => dispatch({ type: 'remove/set', open })}
        onConfirm={() => {
          dispatch({ type: 'remove/set', open: false })
          onRemove()
        }}
      />
    </div>
  )
}

function ProfileDetailHeader({
  profile,
  kindLabel,
  icon,
  health,
  saveState,
  onRefreshHealth,
  onToggle,
  onOpenRemove,
}: {
  profile: AgentProfile
  kindLabel: string
  icon: ReactNode
  health: HealthStatus
  saveState: SaveState
  onRefreshHealth: () => void
  onToggle: (enabled: boolean) => void
  onOpenRemove: () => void
}) {
  return (
    <header className="flex items-start gap-3">
      {icon}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-heading truncate text-[15px] font-medium text-foreground">
            {profile.name}
          </h4>
          <Badge variant="secondary" className="font-normal text-muted-foreground">
            {kindLabel}
          </Badge>
          <HealthBadge status={health} onRefresh={onRefreshHealth} disabled={!profile.enabled} />
        </div>
        <p className="mt-1 truncate text-[11.5px] text-muted-foreground/80">
          {profile.id}
        </p>
      </div>

      <div className="flex items-center gap-3 pt-0.5">
        <SaveIndicator state={saveState} />

        <div className="flex items-center gap-2 rounded-full bg-muted/40 px-2.5 py-1 ring-1 ring-foreground/4">
          <Switch
            size="sm"
            checked={profile.enabled}
            onCheckedChange={onToggle}
          />
          <span className="text-[11px] font-medium text-muted-foreground">
            {profile.enabled ? 'Active' : 'Off'}
          </span>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              data-testid={`agent-profile-remove-${profile.id}`}
              variant="ghost"
              size="icon-sm"
              onClick={onOpenRemove}
              className="text-muted-foreground/60 hover:bg-destructive/6 hover:text-destructive"
            >
              <Trash2Icon className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Remove provider</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}

function ProfileGeneralSettings({
  profile,
  form,
  supportsModels,
  supportsCommand,
}: {
  profile: AgentProfile
  form: UseFormReturn<ProfileDetailFormValues>
  supportsModels: boolean
  supportsCommand: boolean
}) {
  return (
    <>
      <SettingsRow label="Display name" description="The name shown in the provider list">
        <Input
          data-testid="provider-edit-name"
          {...form.register('name')}
          className="h-9 w-56 text-[13px]"
        />
      </SettingsRow>

      {supportsModels && (
        <>
          <SettingsDivider />
          <SettingsRow label="Endpoint" description="Base URL for the API">
            <Input
              data-testid="provider-edit-baseurl"
              {...form.register('baseUrl')}
              className="h-9 w-56 text-[12.5px] font-mono"
              placeholder="https://api.openai.com/v1"
            />
          </SettingsRow>

          <SettingsDivider />
          <SettingsRow label="Default model" description="Used when no model is specified in the session">
            <Input
              data-testid="provider-edit-model"
              {...form.register('model')}
              className="h-9 w-56 text-[12.5px] font-mono"
              placeholder="e.g. gpt-4o"
            />
          </SettingsRow>

          <SettingsDivider />
          <SettingsRow
            label="API key"
            description={profile.credentialRef
              ? 'A credential is already stored. Leave empty to keep it.'
              : 'Stored locally and encrypted.'}
          >
            <Input
              data-testid="provider-edit-apikey"
              type="password"
              {...form.register('apiKey')}
              placeholder={profile.credentialRef ? 'Configured · type to replace' : 'sk-…'}
              className="h-9 w-56 text-[12.5px] font-mono"
            />
          </SettingsRow>
        </>
      )}

      {supportsCommand && (
        <>
          <SettingsDivider />
          <SettingsRow label="Command" description="Executable that Cradle launches when this provider is used">
            <Input
              {...form.register('command')}
              className="h-9 w-56 text-[12.5px] font-mono"
              placeholder="claude"
            />
          </SettingsRow>
        </>
      )}
    </>
  )
}

function ProfileModelsSection({
  loading,
  models,
  enabledModels,
  onChange,
}: {
  loading: boolean
  models: ModelDescriptor[]
  enabledModels: string[]
  onChange: (next: string[]) => void
}) {
  return (
    <>
      <Separator className="bg-foreground/6" />
      <section className="mt-4 flex flex-col gap-4">
        <ModelsPanel
          loading={loading}
          models={models}
          enabledModels={enabledModels}
          onChange={onChange}
        />
      </section>
    </>
  )
}

function ProfileCustomModelsSection({
  profileId,
  customModelsJson,
  onSaved,
}: {
  profileId: string
  customModelsJson: string
  onSaved: () => void
}) {
  const [models, setModels] = useState(() => {
    try {
      const parsed = JSON.parse(customModelsJson) as Array<{ id: string, label: string, capabilities?: ModelCapabilities, contextWindow?: number | null }>
      // Backward compat: migrate old { contextWindow } → { capabilities: { contextWindow } }
      return parsed.map(m => ({
        id: m.id,
        label: m.label,
        capabilities: m.capabilities ?? (m.contextWindow != null ? { contextWindow: m.contextWindow } : {}),
      }))
    }
    catch {
      return []
    }
  })

  // Sync from props when profile changes
  useEffect(() => {
    try {
      const parsed = JSON.parse(customModelsJson) as Array<{ id: string, label: string, capabilities?: ModelCapabilities, contextWindow?: number | null }>
      setModels(parsed.map(m => ({
        id: m.id,
        label: m.label,
        capabilities: m.capabilities ?? (m.contextWindow != null ? { contextWindow: m.contextWindow } : {}),
      })))
    }
    catch {
      setModels([])
    }
  }, [customModelsJson])

  const handleChange = useCallback(async (next: Array<{ id: string, label: string, capabilities: ModelCapabilities }>) => {
    setModels(next)
    try {
      const res = await fetch(`${getServerUrl()}/profiles/${profileId}/custom-models`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ models: next.map(m => ({ id: m.id, label: m.label !== m.id ? m.label : undefined, capabilities: m.capabilities })) }),
      })
      if (res.ok) {
        const saved = await res.json() as Array<{ id: string, label: string, capabilities: ModelCapabilities }>
        setModels(saved)
        onSaved()
      }
    }
    catch { /* ignore — optimistic update stays */ }
  }, [profileId, onSaved])

  return (
    <>
      <Separator className="bg-foreground/6" />
      <section className="mt-4 flex flex-col gap-4">
        <CustomModelsEditor
          profileId={profileId}
          models={models}
          onChange={handleChange}
        />
      </section>
    </>
  )
}

function RemoveProfileDialog({
  open,
  profileName,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  profileName: string
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Trash2Icon />
          </AlertDialogMedia>
          <AlertDialogTitle>Remove provider?</AlertDialogTitle>
          <AlertDialogDescription>
            <strong className="text-foreground">{profileName}</strong>
            {' '}
            will be disconnected from every agent that uses it. Stored credentials
            will be deleted from this machine. You can always add it back later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
          <AlertDialogAction
            size="sm"
            variant="destructive"
            onClick={onConfirm}
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ─── Health badge ─────────────────────────────────────────────────────────────

function HealthPill({ tone, label, icon, onRefresh, disabled }: {
  tone: 'active' | 'muted' | 'warning' | 'destructive'
  label: string
  icon: ReactNode
  onRefresh: () => void
  disabled: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onRefresh}
          disabled={disabled}
          className={cn(
            'group/health inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium transition-colors',
            tone === 'active' && 'bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/15 dark:text-emerald-400',
            tone === 'muted' && 'bg-muted/60 text-muted-foreground ring-1 ring-foreground/4',
            tone === 'warning' && 'bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/15 dark:text-amber-400',
            tone === 'destructive' && 'bg-destructive/10 text-destructive ring-1 ring-destructive/15',
            'disabled:opacity-60 disabled:cursor-not-allowed',
            !disabled && 'hover:brightness-105 cursor-pointer',
          )}
        >
          {icon}
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {disabled ? 'Enable provider to verify connection' : 'Click to verify connection'}
      </TooltipContent>
    </Tooltip>
  )
}

function HealthBadge({
  status,
  onRefresh,
  disabled,
}: {
  status: HealthStatus
  onRefresh: () => void
  disabled: boolean
}) {
  if (disabled) {
    return <HealthPill tone="muted" label="Disabled" icon={<CircleDashedIcon className="size-3" />} onRefresh={onRefresh} disabled={disabled} />
  }
  if (status === 'verifying') {
    return <HealthPill tone="muted" label="Verifying" icon={<Spinner className="size-3" />} onRefresh={onRefresh} disabled={disabled} />
  }
  if (status === 'connected') {
    return <HealthPill tone="active" label="Connected" icon={<CircleCheckIcon className="size-3" />} onRefresh={onRefresh} disabled={disabled} />
  }
  if (status === 'failed') {
    return <HealthPill tone="destructive" label="Disconnected" icon={<CircleAlertIcon className="size-3" />} onRefresh={onRefresh} disabled={disabled} />
  }
  return <HealthPill tone="muted" label="Idle" icon={<CircleDashedIcon className="size-3" />} onRefresh={onRefresh} disabled={disabled} />
}

// ─── Save indicator ───────────────────────────────────────────────────────────

function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <AnimatePresence>
      {state !== 'idle' && (
        <m.span
          initial={{ opacity: 0, x: 4 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -2 }}
          transition={{ duration: 0.18 }}
          className={cn(
            'flex items-center gap-1 text-[11px] font-medium',
            state === 'saving' || state === 'pending' ? 'text-muted-foreground' : '',
            state === 'saved' ? 'text-emerald-600 dark:text-emerald-400' : '',
            state === 'error' ? 'text-destructive' : '',
          )}
        >
          {(state === 'saving' || state === 'pending') && <Spinner className="size-2.5" />}
          {state === 'saved' && <CheckIcon className="size-3" />}
          {state === 'error' && <CircleAlertIcon className="size-3" />}
          {(state === 'saving' || state === 'pending') && 'Saving'}
          {state === 'saved' && 'Saved'}
          {state === 'error' && 'Save failed'}
        </m.span>
      )}
    </AnimatePresence>
  )
}
