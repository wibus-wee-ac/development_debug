import { useQueryClient } from '@tanstack/react-query'
import {
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  ExternalLinkIcon,
  Trash2Icon,
} from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import type { MutableRefObject, ReactNode } from 'react'
import { memo, useCallback, useEffect, useEffectEvent, useMemo, useReducer, useRef, useState } from 'react'
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
import { IconPicker } from '~/components/ui/icon-picker'
import { Input } from '~/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Separator } from '~/components/ui/separator'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { ProfileConfigJsonSchema } from '~/features/agent-runtime/profile-config-schema'
import { AGENT_MODELS_QUERY_KEY } from '~/features/agent-runtime/use-agent-models'
import { cn } from '~/lib/cn'
import { getServerUrl } from '~/lib/electron'
import type { AgentProfile, ModelCapabilities, ModelDescriptor } from '~/lib/types'

import { SettingsDivider, SettingsRow } from '../settings/settings-row'
import { ALL_DISABLED_SENTINEL, presetForProfile, PROVIDER_KIND_LABELS } from './agent-runtime-settings'
import { CustomModelsEditor } from './custom-models-editor'
import { ModelsPanel } from './models-panel'
import { ProviderIcon } from './provider-icons'

type HealthStatus = 'unknown' | 'verifying' | 'connected' | 'failed'
type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'
type ProfileTextField = 'name' | 'apiKey' | 'baseUrl' | 'api'

interface EditableCustomModel {
  id: string
  label: string
  capabilities: ModelCapabilities
}

interface StoredCustomModel {
  id?: unknown
  label?: unknown
  capabilities?: unknown
  contextWindow?: unknown
}

interface ProfileDetailFormValues {
  name: string
  apiKey: string
  baseUrl: string
  model: string
  api: string
  enabledModels: string[]
}

interface ProfileDetailUiState {
  availableModels: ModelDescriptor[]
  modelsLoading: boolean
  modelsCachedAt: number | null
  health: HealthStatus
  saveState: SaveState
  confirmRemove: boolean
}

interface ExternalProviderSourceView {
  id: string
  label: string
  lastSyncStatus: 'never' | 'ok' | 'warning' | 'error'
  lastSyncMessage: string | null
  lastSyncError: string | null
  lastSyncAt: number | null
  inventory: Record<string, unknown>
  warnings: Array<{ code: string, message: string, severity: 'info' | 'warning' | 'error' }>
}

interface ExternalProviderRecordView {
  id: string
  sourceKey: string
  externalId: string
  app: string
  status: 'active' | 'stale' | 'missing' | 'unsupported' | 'error'
  metadata: Record<string, unknown>
  warnings: Array<{ code: string, message: string, severity: 'info' | 'warning' | 'error' }>
}

interface ExternalProfileLinkView {
  sourceKey: string
  externalRecordId: string
  profileId: string
  credentialRef: string | null
  sourceOwnedFields: string[]
}

interface ExternalProfileMetadata {
  link: ExternalProfileLinkView
  source: ExternalProviderSourceView | null
  record: ExternalProviderRecordView | null
}

type ProfileDetailUiAction = { type: 'reset' }
  | { type: 'models/loading' }
  | { type: 'models/loaded', models: ModelDescriptor[], cachedAt?: number | null }
  | { type: 'models/failed' }
  | { type: 'models/update-one', model: ModelDescriptor }
  | { type: 'health/set', status: HealthStatus }
  | { type: 'save/set', state: SaveState }
  | { type: 'remove/set', open: boolean }

const INITIAL_UI_STATE: ProfileDetailUiState = {
  availableModels: [],
  modelsLoading: false,
  modelsCachedAt: null,
  health: 'unknown',
  saveState: 'idle',
  confirmRemove: false,
}

const EMPTY_ENABLED_MODELS: string[] = []

function readModelCapabilities(value: unknown): ModelCapabilities {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ModelCapabilities : {}
}

function normalizeEditableCustomModel(value: unknown): EditableCustomModel | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as StoredCustomModel
  const id = typeof item.id === 'string' ? item.id.trim() : ''
  if (!id) {
    return null
  }

  const label = typeof item.label === 'string' && item.label.trim() ? item.label.trim() : id
  const capabilities = readModelCapabilities(item.capabilities)

  if (capabilities.contextWindow == null && typeof item.contextWindow === 'number') {
    capabilities.contextWindow = item.contextWindow
  }

  return { id, label, capabilities }
}

function parseCustomModelsJson(customModelsJson: string): EditableCustomModel[] {
  try {
    const parsed = JSON.parse(customModelsJson) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.flatMap((item) => {
      const normalized = normalizeEditableCustomModel(item)
      return normalized ? [normalized] : []
    })
  }
  catch {
    return []
  }
}

function profileDetailUiReducer(state: ProfileDetailUiState, action: ProfileDetailUiAction): ProfileDetailUiState {
  switch (action.type) {
    case 'reset':
      return INITIAL_UI_STATE
    case 'models/loading':
      return { ...state, modelsLoading: true }
    case 'models/loaded':
      return { ...state, availableModels: action.models, modelsLoading: false, modelsCachedAt: action.cachedAt ?? Date.now() }
    case 'models/failed':
      return { ...state, availableModels: [], modelsLoading: false }
    case 'models/update-one':
      return {
        ...state,
        availableModels: state.availableModels.map(model => model.id === action.model.id ? action.model : model),
      }
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

function getInitialEnabledModels(enabledModels: string[]): string[] {
  if (enabledModels.length === 0) {
    return [ALL_DISABLED_SENTINEL]
  }
  return enabledModels
}

function getProfileFormValues(profile: AgentProfile): ProfileDetailFormValues {
  const config = ProfileConfigJsonSchema.parse(profile.configJson)
  return {
    name: profile.name,
    apiKey: '',
    baseUrl: config.baseUrl,
    model: config.model,
    api: config.api,
    enabledModels: getInitialEnabledModels(config.enabledModels),
  }
}

function buildProviderRequestBody(profile: AgentProfile) {
  return {
    providerKind: profile.providerKind,
    label: profile.name,
    config: ProfileConfigJsonSchema.parse(profile.configJson),
    secretRef: profile.credentialRef ?? null,
    profileId: profile.id,
  }
}

function buildProfileConfig(values: ProfileDetailFormValues, currentConfig: Record<string, unknown>): Record<string, unknown> {
  const cleanEnabled = values.enabledModels.filter(id => id !== ALL_DISABLED_SENTINEL)
  const allDisabledNow = values.enabledModels[0] === ALL_DISABLED_SENTINEL
  return {
    ...currentConfig,
    baseUrl: values.baseUrl,
    model: values.model || undefined,
    api: values.api || undefined,
    enabledModels: cleanEnabled.length > 0
      ? cleanEnabled
      : allDisabledNow
        ? []
        : undefined,
  }
}

function createProfileSignature(values: ProfileDetailFormValues): string {
  return JSON.stringify({
    name: values.name,
    apiKey: values.apiKey,
    baseUrl: values.baseUrl,
    model: values.model,
    api: values.api,
    enabledModels: values.enabledModels,
  })
}

function clearTimer(timerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>) {
  if (!timerRef.current) {
    return
  }

  clearTimeout(timerRef.current)
  timerRef.current = null
}

async function loadExternalProfileMetadata(profileId: string): Promise<ExternalProfileMetadata | null> {
  const baseUrl = getServerUrl()
  const linkRes = await fetch(`${baseUrl}/profiles/${encodeURIComponent(profileId)}/external-source`)
  if (linkRes.status === 404) {
    return null
  }
  if (!linkRes.ok) {
    throw new Error('Failed to load external profile metadata')
  }

  const link = await linkRes.json() as ExternalProfileLinkView
  const [sourcesRes, recordsRes] = await Promise.all([
    fetch(`${baseUrl}/external-provider-sources`),
    fetch(`${baseUrl}/external-provider-sources/records`),
  ])
  const sources = sourcesRes.ok ? await sourcesRes.json() as ExternalProviderSourceView[] : []
  const records = recordsRes.ok ? await recordsRes.json() as ExternalProviderRecordView[] : []
  return {
    link,
    source: sources.find(source => source.id === link.sourceKey) ?? null,
    record: records.find(record => record.id === profileId) ?? null,
  }
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
  const queryClient = useQueryClient()

  const supportsModels = true

  const form = useForm<ProfileDetailFormValues>({
    defaultValues: getProfileFormValues(profile),
  })
  const name = useWatch({ control: form.control, name: 'name' }) ?? ''
  const apiKey = useWatch({ control: form.control, name: 'apiKey' }) ?? ''
  const baseUrl = useWatch({ control: form.control, name: 'baseUrl' }) ?? ''
  const model = useWatch({ control: form.control, name: 'model' }) ?? ''
  const api = useWatch({ control: form.control, name: 'api' }) ?? ''
  const enabledModels = useWatch({ control: form.control, name: 'enabledModels' }) ?? EMPTY_ENABLED_MODELS

  const [uiState, dispatch] = useReducer(profileDetailUiReducer, INITIAL_UI_STATE)
  const [externalMetadata, setExternalMetadata] = useState<ExternalProfileMetadata | null>(null)
  const {
    availableModels,
    modelsLoading,
    modelsCachedAt,
    health,
    saveState,
    confirmRemove,
  } = uiState

  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const modelsRequestRef = useRef(0)
  const healthRequestRef = useRef(0)
  const saveRequestRef = useRef(0)
  const savedSignatureRef = useRef(createProfileSignature(getProfileFormValues(profile)))
  const isExternalProfile = externalMetadata !== null

  const createProviderRequestBody = useCallback(() => buildProviderRequestBody(profile), [profile])
  const createProviderRequestBodyRef = useRef(createProviderRequestBody)
  createProviderRequestBodyRef.current = createProviderRequestBody

  const setTextField = useCallback((field: ProfileTextField, value: string) => {
    form.setValue(field, value, { shouldDirty: true })
  }, [form])

  const handleEnabledModelsChange = useCallback((next: string[]) => {
    form.setValue('enabledModels', next, { shouldDirty: true })
  }, [form])

  const handleModelRegistryMapped = useCallback((next: ModelDescriptor) => {
    dispatch({ type: 'models/update-one', model: next })
    void queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY })
    onSaved()
  }, [queryClient, onSaved])

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
    const initialValues = getProfileFormValues(profile)
    savedSignatureRef.current = createProfileSignature(initialValues)
    form.reset(initialValues)
    setExternalMetadata(null)
    dispatch({ type: 'reset' })
    void loadExternalProfileMetadata(profile.id)
      .then(setExternalMetadata)
      .catch(() => setExternalMetadata(null))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId])

  // Fetch available models (only when provider connection details change, not enabledModels)
  const modelFetchKey = useMemo(() => {
    const config = ProfileConfigJsonSchema.parse(profile.configJson)
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

    // Try cache first, then fresh fetch
    const cacheUrl = `${getServerUrl()}/providers/${encodeURIComponent(profile.id)}/models-cache`
    fetch(cacheUrl)
      .then(res => res.ok ? res.json() : null)
      .then((cache: { models: ModelDescriptor[], cached: boolean, stale: boolean } | null) => {
        if (requestId !== modelsRequestRef.current) {
          return
        }

        if (cache?.cached && cache.models.length > 0) {
          dispatch({ type: 'models/loaded', models: cache.models })
          // If stale, also trigger a background refresh
          if (cache.stale) {
            postProvidersModels({ body: createProviderRequestBodyRef.current() })
              .then(({ data }) => {
                if (requestId !== modelsRequestRef.current) {
                  return
                }
                dispatch({ type: 'models/loaded', models: (data ?? []) as ModelDescriptor[], cachedAt: Date.now() })
              })
              .catch(() => {})
          }
          return
        }

        // No cache or empty — do a fresh fetch
        postProvidersModels({ body: createProviderRequestBodyRef.current() })
          .then(({ data }) => {
            if (requestId !== modelsRequestRef.current) {
              return
            }
            dispatch({ type: 'models/loaded', models: (data ?? []) as ModelDescriptor[], cachedAt: Date.now() })
          })
          .catch(() => {
            if (requestId !== modelsRequestRef.current) {
              return
            }
            dispatch({ type: 'models/failed' })
          })
      })
      .catch(() => {
        // Cache fetch failed — fallback to direct fetch
        postProvidersModels({ body: createProviderRequestBodyRef.current() })
          .then(({ data }) => {
            if (requestId !== modelsRequestRef.current) {
              return
            }
            dispatch({ type: 'models/loaded', models: (data ?? []) as ModelDescriptor[], cachedAt: Date.now() })
          })
          .catch(() => {
            if (requestId !== modelsRequestRef.current) {
              return
            }
            dispatch({ type: 'models/failed' })
          })
      })
  }, [supportsModels, profile.id, modelFetchKey])

  const handleRefreshModels = useCallback(() => {
    const requestId = ++modelsRequestRef.current
    dispatch({ type: 'models/loading' })

    postProvidersModels({ body: createProviderRequestBodyRef.current() })
      .then(({ data }) => {
        if (requestId !== modelsRequestRef.current) {
          return
        }
        dispatch({ type: 'models/loaded', models: (data ?? []) as ModelDescriptor[], cachedAt: Date.now() })
      })
      .catch(() => {
        if (requestId !== modelsRequestRef.current) {
          return
        }
        dispatch({ type: 'models/failed' })
      })
  }, [])

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

  const saveProfile = useEffectEvent(async () => {
    const currentValues = form.getValues()
    const requestId = ++saveRequestRef.current
    dispatch({ type: 'save/set', state: 'saving' })

    try {
      let credentialRef = profile.credentialRef ?? null
      if (currentValues.apiKey && supportsModels) {
        const { data: meta } = await postSecrets({
          body: { kind: profile.providerKind, label: currentValues.name, secret: currentValues.apiKey },
        })
        credentialRef = (meta as Record<string, unknown>)?.id as string ?? credentialRef
      }

      await putProfilesById({
        path: { id: profile.id },
        body: {
          name: currentValues.name,
          providerKind: profile.providerKind,
          enabled: profile.enabled,
          config: supportsModels
            ? buildProfileConfig(currentValues, ProfileConfigJsonSchema.parse(profile.configJson))
            : ProfileConfigJsonSchema.parse(profile.configJson),
          credentialRef,
        },
      })

      if (requestId !== saveRequestRef.current) {
        return
      }

      dispatch({ type: 'save/set', state: 'saved' })
      const savedValues = {
        ...currentValues,
        apiKey: '',
      }
      savedSignatureRef.current = createProfileSignature(savedValues)
      form.reset(savedValues)
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
  })

  const watchedSignature = useMemo(() => JSON.stringify({
    name,
    apiKey,
    baseUrl,
    model,
    api,
    enabledModels,
  }), [name, apiKey, baseUrl, model, api, enabledModels])

  // Auto-save with debounce — but skip the very first run after switching profiles
  useEffect(() => {
    if (isExternalProfile) {
      dispatch({ type: 'save/set', state: 'idle' })
      clearAutoSaveTimer()
      return
    }
    if (watchedSignature === savedSignatureRef.current || saveState === 'saving') {
      return
    }

    dispatch({ type: 'save/set', state: 'pending' })
    clearAutoSaveTimer()
    const timeoutId = setTimeout(() => {
      void saveProfile()
    }, 1200)

    autoSaveTimerRef.current = timeoutId

    return () => {
      clearTimeout(timeoutId)
      if (autoSaveTimerRef.current === timeoutId) {
        autoSaveTimerRef.current = null
      }
    }
  }, [isExternalProfile, watchedSignature, saveState, clearAutoSaveTimer])

  // ── Icon change handler ──
  const handleIconChange = useCallback((slug: string | null) => {
    if (isExternalProfile) {
      return
    }
    fetch(`${getServerUrl()}/profiles/${encodeURIComponent(profile.id)}/icon`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iconSlug: slug }),
    }).then(() => {
      onSaved()
    }).catch(() => {})
  }, [isExternalProfile, profile.id, onSaved])

  const kindLabel = PROVIDER_KIND_LABELS[profile.providerKind]

  return (
    <div data-testid="provider-detail-panel" className="flex flex-col gap-2">
      <ProfileDetailHeader
        profile={profile}
        kindLabel={kindLabel}
        icon={(
          isExternalProfile
            ? (
              <button type="button" className="mt-1 shrink-0 rounded-md p-0.5 text-muted-foreground" disabled>
                <ProviderIcon iconSlug={profile.iconSlug} presetId={preset.id} className="size-6" />
              </button>
            )
            : (
              <IconPicker value={profile.iconSlug ?? null} onChange={handleIconChange}>
                <button type="button" className="mt-1 shrink-0 cursor-pointer rounded-md p-0.5 transition-colors hover:bg-fill">
                  <ProviderIcon iconSlug={profile.iconSlug} presetId={preset.id} className="size-6" />
                </button>
              </IconPicker>
            )
        )}
        health={health}
        saveState={saveState}
        isExternalProfile={isExternalProfile}
        onRefreshHealth={() => void runHealthCheck()}
        onToggle={onToggle}
        onOpenRemove={() => dispatch({ type: 'remove/set', open: true })}
      />

      {/* Configuration */}
      <div className="flex flex-col">
        {externalMetadata && (
          <>
            <ExternalSourceSection metadata={externalMetadata} />
            <SettingsDivider />
          </>
        )}

        <ProfileGeneralSettings
          profile={profile}
          values={{ name, apiKey, baseUrl, api }}
          onTextFieldChange={setTextField}
          supportsModels={supportsModels}
          readOnly={isExternalProfile}
        />

        {supportsModels && !isExternalProfile && (
          // eslint-disable-next-line ts/no-use-before-define
          <MemoizedProfileModelsSection
            loading={modelsLoading}
            profileId={profile.id}
            models={availableModels}
            enabledModels={enabledModels}
            onChange={handleEnabledModelsChange}
            onModelRegistryMapped={handleModelRegistryMapped}
            onRefresh={handleRefreshModels}
            cachedAt={modelsCachedAt}
          />
        )}

        {supportsModels && !isExternalProfile && (
          // eslint-disable-next-line ts/no-use-before-define
          <MemoizedProfileCustomModelsSection profileId={profile.id} customModelsJson={profile.customModels} onSaved={onSaved} />
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
  isExternalProfile,
  onRefreshHealth,
  onToggle,
  onOpenRemove,
}: {
  profile: AgentProfile
  kindLabel: string
  icon: ReactNode
  health: HealthStatus
  saveState: SaveState
  isExternalProfile: boolean
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
              disabled={isExternalProfile}
              className="text-muted-foreground/60 hover:bg-destructive/6 hover:text-destructive"
            >
              <Trash2Icon className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{isExternalProfile ? 'Managed by external source' : 'Remove provider'}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}

function ExternalSourceSection({ metadata }: { metadata: ExternalProfileMetadata }) {
  const { source, record, link } = metadata
  const baseUrl = typeof record?.metadata.baseUrl === 'string' ? record.metadata.baseUrl : null
  const model = typeof record?.metadata.model === 'string' ? record.metadata.model : null

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-foreground/6 bg-foreground/[0.015] p-3">
      <div className="flex items-center gap-2">
        <ExternalLinkIcon className="size-3.5 text-muted-foreground" />
        <h5 className="text-[12px] font-medium text-foreground">External source</h5>
        <Badge variant="secondary" className="font-normal">
          Managed
        </Badge>
      </div>

      <div className="grid gap-3">
        <SettingsRow label="Source" description="The plugin-owned reader that supplies this provider">
          <div className="flex flex-col gap-1 text-[12px] text-foreground">
            <span>{source?.label ?? 'External source'}</span>
            <span className="text-muted-foreground">
              {source?.lastSyncStatus ?? 'never'}
              {source?.lastSyncError ? ` · ${source.lastSyncError}` : ''}
            </span>
          </div>
        </SettingsRow>

        <SettingsRow label="External id" description="Stable external record identifier">
          <span className="font-mono text-[12px] text-foreground">{link.externalRecordId}</span>
        </SettingsRow>

        <SettingsRow label="Scope" description="External app and projection scope">
          <div className="flex flex-col gap-1 text-[12px] text-foreground">
            <span>{record?.app ?? 'unknown'}</span>
            <span className="text-muted-foreground">{link.profileId}</span>
          </div>
        </SettingsRow>

        {baseUrl && (
          <SettingsRow label="Base URL" description="Source-provided endpoint">
            <span className="font-mono text-[12px] text-foreground">{baseUrl}</span>
          </SettingsRow>
        )}

        {model && (
          <SettingsRow label="Model" description="Source-provided default model">
            <span className="font-mono text-[12px] text-foreground">{model}</span>
          </SettingsRow>
        )}

        <SettingsRow label="Warnings" description="Snapshot warnings reported by the source">
          <div className="flex flex-col gap-1">
            {(source?.warnings ?? record?.warnings ?? []).length > 0
              ? (source?.warnings ?? record?.warnings ?? []).map((warning, index) => (
                <div key={`${warning.code}-${index}`} className="text-[12px] text-muted-foreground">
                  {warning.severity}
                  {': '}
                  {warning.message}
                </div>
              ))
              : <span className="text-[12px] text-muted-foreground">None</span>}
          </div>
        </SettingsRow>

        <SettingsRow label="Inventory" description="What else the source detected">
          <div className="flex flex-wrap gap-2 text-[12px] text-muted-foreground">
            {Object.entries(source?.inventory ?? {}).length === 0
              ? <span>None</span>
              : Object.entries(source?.inventory ?? {}).map(([key, value]) => (
                <span key={key} className="rounded-full bg-muted px-2 py-0.5">
                  {key}
                  {': '}
                  {String(value)}
                </span>
              ))}
          </div>
        </SettingsRow>
      </div>
    </section>
  )
}

function ProfileGeneralSettings({
  profile,
  values,
  onTextFieldChange,
  supportsModels,
  readOnly,
}: {
  profile: AgentProfile
  values: Pick<ProfileDetailFormValues, ProfileTextField>
  onTextFieldChange: (field: ProfileTextField, value: string) => void
  supportsModels: boolean
  readOnly: boolean
}) {
  return (
    <>
      <SettingsRow label="Display name" description="The name shown in the provider list">
        <Input
          data-testid="provider-edit-name"
          value={values.name}
          onChange={e => onTextFieldChange('name', e.target.value)}
          disabled={readOnly}
          className="h-9 w-56 text-[13px]"
        />
      </SettingsRow>

      {supportsModels && (
        <>
          <SettingsDivider />
          <SettingsRow label="Endpoint" description="Base URL for the API">
            <Input
              data-testid="provider-edit-baseurl"
              value={values.baseUrl}
              onChange={e => onTextFieldChange('baseUrl', e.target.value)}
              disabled={readOnly}
              className="h-9 w-56 text-[12.5px] font-mono"
              placeholder="https://api.openai.com/v1"
            />
          </SettingsRow>

          <SettingsDivider />
          <SettingsRow label="API protocol" description="Communication protocol for this endpoint">
            <Select value={values.api || 'auto'} onValueChange={v => onTextFieldChange('api', v === 'auto' ? '' : v)} disabled={readOnly}>
              <SelectTrigger className="h-9 w-56 text-[12.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto-detect</SelectItem>
                <SelectItem value="openai-completions">OpenAI Completions</SelectItem>
                <SelectItem value="openai-responses">OpenAI Responses</SelectItem>
                <SelectItem value="anthropic-messages">Anthropic Messages</SelectItem>
                <SelectItem value="google-generative-ai">Google Generative AI</SelectItem>
                <SelectItem value="bedrock-converse-stream">AWS Bedrock</SelectItem>
                <SelectItem value="mistral-conversations">Mistral</SelectItem>
              </SelectContent>
            </Select>
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
              value={values.apiKey}
              onChange={e => onTextFieldChange('apiKey', e.target.value)}
              disabled={readOnly}
              placeholder={profile.credentialRef ? 'Configured · type to replace' : 'sk-…'}
              className="h-9 w-56 text-[12.5px] font-mono"
            />
          </SettingsRow>
        </>
      )}

    </>
  )
}

function ProfileModelsSection({
  loading,
  profileId,
  models,
  enabledModels,
  onChange,
  onModelRegistryMapped,
  onRefresh,
  cachedAt,
}: {
  loading: boolean
  profileId: string
  models: ModelDescriptor[]
  enabledModels: string[]
  onChange: (next: string[]) => void
  onModelRegistryMapped: (next: ModelDescriptor) => void
  onRefresh?: () => void
  cachedAt?: number | null
}) {
  return (
    <>
      <Separator className="bg-foreground/6" />
      <section className="mt-4 flex flex-col gap-4">
        <ModelsPanel
          loading={loading}
          profileId={profileId}
          models={models}
          enabledModels={enabledModels}
          onChange={onChange}
          onModelRegistryMapped={onModelRegistryMapped}
          onRefresh={onRefresh}
          cachedAt={cachedAt}
        />
      </section>
    </>
  )
}

const MemoizedProfileModelsSection = memo(ProfileModelsSection)

function ProfileCustomModelsSection({
  profileId,
  customModelsJson,
  onSaved,
}: {
  profileId: string
  customModelsJson: string
  onSaved: () => void
}) {
  const queryClient = useQueryClient()
  const [models, setModels] = useState(() => parseCustomModelsJson(customModelsJson))

  // Sync from props when profile changes
  useEffect(() => {
    setModels(parseCustomModelsJson(customModelsJson))
  }, [customModelsJson])

  const saveCustomModels = useCallback(async (next: EditableCustomModel[]) => {
    const sanitized = next.flatMap((item) => {
      const normalized = normalizeEditableCustomModel(item)
      return normalized ? [normalized] : []
    })

    setModels(sanitized)
    try {
      const res = await fetch(`${getServerUrl()}/profiles/${profileId}/custom-models`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          models: sanitized.map(m => ({
            id: m.id,
            label: m.label !== m.id ? m.label : undefined,
            capabilities: m.capabilities,
          })),
        }),
      })
      if (res.ok) {
        const saved = await res.json() as unknown
        setModels(Array.isArray(saved)
          ? saved.flatMap((item) => {
              const normalized = normalizeEditableCustomModel(item)
              return normalized ? [normalized] : []
            })
          : sanitized)
        void queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY })
        onSaved()
      }
    }
    catch { /* ignore — optimistic update stays */ }
  }, [profileId, queryClient, onSaved])

  return (
    <>
      <Separator className="bg-foreground/6" />
      <section className="mt-4 flex flex-col gap-4">
        <CustomModelsEditor
          profileId={profileId}
          models={models}
          onChange={saveCustomModels}
        />
      </section>
    </>
  )
}

const MemoizedProfileCustomModelsSection = memo(ProfileCustomModelsSection)

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
