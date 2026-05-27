import { useQueryClient } from '@tanstack/react-query'
import { CheckIcon, CircleAlertIcon, Trash2Icon } from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import type { MutableRefObject, ReactNode } from 'react'
import {
  memo,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'

import { getProvidersTargetsByProviderTargetIdModelsCacheOptions } from '~/api-gen/@tanstack/react-query.gen'
import {
  patchProfilesByIdIcon,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Separator } from '~/components/ui/separator'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { toastManager } from '~/components/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { ProfileConfigJsonSchema } from '~/features/agent-runtime/profile-config-schema'
import { AGENT_MODELS_QUERY_KEY } from '~/features/agent-runtime/use-agent-models'
import { cn } from '~/lib/cn'
import type { AgentProfile, ModelDescriptor, ProviderTarget } from '~/lib/types'

import { SettingsDivider, SettingsRow } from '../settings/settings-row'
import { CustomModelsEditor } from './custom-models-editor'
import { ModelsPanel } from './models-panel'
import { ProviderIcon } from './provider-icons'
import {
  ALL_DISABLED_SENTINEL,
  presetForProfile,
  PROVIDER_KIND_LABELS,
} from './provider-settings-utils'
import type { EditableCustomModel } from './provider-target-model-settings'
import {
  CustomModelsJsonSchema,
  updateProviderTargetCustomModels,
} from './provider-target-model-settings'

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'
type ProfileTextField = 'name' | 'apiKey' | 'baseUrl' | 'api'

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
  saveState: SaveState
  confirmRemove: boolean
}

const SecretCreateResponseSchema = z.object({
  id: z.string().min(1),
})

type ProfileDetailUiAction
  = | { type: 'reset' }
    | { type: 'models/loading' }
    | { type: 'models/loaded', models: ModelDescriptor[], cachedAt?: number | null }
    | { type: 'models/failed' }
    | { type: 'models/update-one', model: ModelDescriptor }
    | { type: 'save/set', state: SaveState }
    | { type: 'remove/set', open: boolean }

const INITIAL_UI_STATE: ProfileDetailUiState = {
  availableModels: [],
  modelsLoading: false,
  modelsCachedAt: null,
  saveState: 'idle',
  confirmRemove: false,
}

const EMPTY_ENABLED_MODELS: string[] = []

const ModelDescriptorSchema = z.object({
  id: z.string(),
  label: z.string(),
  providerKind: z.enum(['openai-compatible', 'anthropic']),
  capabilities: z
    .object({
      contextWindow: z.number().optional(),
    })
    .passthrough()
    .default({}),
})

const ModelDescriptorListSchema = z.array(ModelDescriptorSchema).default([])

const ProviderModelsCacheSchema = z
  .object({
    models: ModelDescriptorListSchema,
    cached: z.boolean(),
    stale: z.boolean(),
  })
  .nullable()

function profileDetailUiReducer(
  state: ProfileDetailUiState,
  action: ProfileDetailUiAction,
): ProfileDetailUiState {
  switch (action.type) {
    case 'reset':
      return INITIAL_UI_STATE
    case 'models/loading':
      return { ...state, modelsLoading: true }
    case 'models/loaded':
      return {
        ...state,
        availableModels: action.models,
        modelsLoading: false,
        modelsCachedAt: 'cachedAt' in action ? (action.cachedAt ?? null) : Date.now(),
      }
    case 'models/failed':
      return { ...state, availableModels: [], modelsLoading: false }
    case 'models/update-one':
      return {
        ...state,
        availableModels: state.availableModels.map(model =>
          model.id === action.model.id ? action.model : model),
      }
    case 'save/set':
      return { ...state, saveState: action.state }
    case 'remove/set':
      return { ...state, confirmRemove: action.open }
    default:
      return state
  }
}

function getInitialEnabledModels(enabledModels: string[]): string[] {
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
    providerTargetKind: 'manual' as const,
    providerTargetId: profile.id,
  }
}

function buildProfileConfig(
  values: ProfileDetailFormValues,
  currentConfig: Record<string, unknown>,
): Record<string, unknown> {
  const cleanEnabled = values.enabledModels.filter(id => id !== ALL_DISABLED_SENTINEL)
  const allDisabledNow = values.enabledModels[0] === ALL_DISABLED_SENTINEL
  return {
    ...currentConfig,
    baseUrl: values.baseUrl,
    model: values.model || undefined,
    api: values.api || undefined,
    enabledModels: cleanEnabled.length > 0 ? cleanEnabled : allDisabledNow ? [] : undefined,
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
  const providerTarget = useMemo<ProviderTarget>(
    () => ({ kind: 'manual', id: profile.id }),
    [profile.id],
  )

  const supportsModels = true

  const form = useForm<ProfileDetailFormValues>({
    defaultValues: getProfileFormValues(profile),
  })
  const name = useWatch({ control: form.control, name: 'name' }) ?? ''
  const apiKey = useWatch({ control: form.control, name: 'apiKey' }) ?? ''
  const baseUrl = useWatch({ control: form.control, name: 'baseUrl' }) ?? ''
  const model = useWatch({ control: form.control, name: 'model' }) ?? ''
  const api = useWatch({ control: form.control, name: 'api' }) ?? ''
  const enabledModels
    = useWatch({ control: form.control, name: 'enabledModels' }) ?? EMPTY_ENABLED_MODELS

  const [uiState, dispatch] = useReducer(profileDetailUiReducer, INITIAL_UI_STATE)
  const { availableModels, modelsLoading, modelsCachedAt, saveState, confirmRemove } = uiState

  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const modelsRequestRef = useRef(0)
  const saveRequestRef = useRef(0)
  const savedSignatureRef = useRef(createProfileSignature(getProfileFormValues(profile)))

  const createProviderRequestBody = useCallback(() => buildProviderRequestBody(profile), [profile])
  const createProviderRequestBodyRef = useRef(createProviderRequestBody)
  createProviderRequestBodyRef.current = createProviderRequestBody

  const setTextField = useCallback(
    (field: ProfileTextField, value: string) => {
      form.setValue(field, value, { shouldDirty: true })
    },
    [form],
  )

  const handleEnabledModelsChange = useCallback(
    (next: string[]) => {
      form.setValue('enabledModels', next, { shouldDirty: true })
    },
    [form],
  )

  const handleModelRegistryMapped = useCallback(
    (next: ModelDescriptor) => {
      dispatch({ type: 'models/update-one', model: next })
      void queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY })
      onSaved()
    },
    [queryClient, onSaved],
  )

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
    saveRequestRef.current += 1
    const initialValues = getProfileFormValues(profile)
    savedSignatureRef.current = createProfileSignature(initialValues)
    form.reset(initialValues)
    dispatch({ type: 'reset' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId])

  useEffect(() => {
    if (!supportsModels) {
      dispatch({ type: 'models/loaded', models: [], cachedAt: null })
      return
    }

    const requestId = ++modelsRequestRef.current
    dispatch({ type: 'models/loading' })

    queryClient
      .fetchQuery(
        getProvidersTargetsByProviderTargetIdModelsCacheOptions({
          path: { providerTargetId: profile.id },
        }),
      )
      .then((rawCache) => {
        const cache = ProviderModelsCacheSchema.parse(rawCache)
        if (requestId !== modelsRequestRef.current) {
          return
        }

        if (cache?.cached && cache.models.length > 0) {
          dispatch({ type: 'models/loaded', models: cache.models, cachedAt: null })
          return
        }

        dispatch({ type: 'models/loaded', models: [], cachedAt: null })
      })
      .catch(() => {
        if (requestId !== modelsRequestRef.current) {
          return
        }
        dispatch({ type: 'models/failed' })
      })
  }, [supportsModels, profile.id, queryClient])

  const handleRefreshModels = useCallback(() => {
    const requestId = ++modelsRequestRef.current
    dispatch({ type: 'models/loading' })

    postProvidersModels({ body: createProviderRequestBodyRef.current() })
      .then(({ data }) => {
        if (requestId !== modelsRequestRef.current) {
          return
        }
        dispatch({
          type: 'models/loaded',
          models: ModelDescriptorListSchema.parse(data),
          cachedAt: Date.now(),
        })
        void queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY })
      })
      .catch(() => {
        if (requestId !== modelsRequestRef.current) {
          return
        }
        dispatch({ type: 'models/failed' })
      })
  }, [queryClient])

  const saveProfile = useEffectEvent(async () => {
    const currentValues = form.getValues()
    const requestId = ++saveRequestRef.current
    dispatch({ type: 'save/set', state: 'saving' })

    try {
      let credentialRef = profile.credentialRef ?? null
      if (currentValues.apiKey && supportsModels) {
        const { data: meta } = await postSecrets({
          body: {
            kind: profile.providerKind,
            label: currentValues.name,
            secret: currentValues.apiKey,
          },
        })
        credentialRef = SecretCreateResponseSchema.parse(meta).id
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

  const watchedSignature = useMemo(
    () =>
      JSON.stringify({
        name,
        apiKey,
        baseUrl,
        model,
        api,
        enabledModels,
      }),
    [name, apiKey, baseUrl, model, api, enabledModels],
  )

  // Auto-save with debounce — but skip the very first run after switching profiles
  useEffect(() => {
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
  }, [watchedSignature, saveState, clearAutoSaveTimer])

  // ── Icon change handler ──
  const handleIconChange = useCallback(
    (slug: string | null) => {
      patchProfilesByIdIcon({
        path: { id: profile.id },
        body: { iconSlug: slug },
      })
        .then(() => {
          onSaved()
        })
        .catch(() => {})
    },
    [profile.id, onSaved],
  )

  const kindLabel = PROVIDER_KIND_LABELS[profile.providerKind]

  return (
    <div data-testid="provider-detail-panel" className="flex flex-col gap-2">
      <ProfileDetailHeader
        profile={profile}
        kindLabel={kindLabel}
        icon={(
          <IconPicker value={profile.iconSlug ?? null} onChange={handleIconChange}>
            <button
              type="button"
              className="mt-1 shrink-0 cursor-pointer rounded-md p-0.5 transition-colors hover:bg-fill"
            >
              <ProviderIcon iconSlug={profile.iconSlug} presetId={preset.id} className="size-6" />
            </button>
          </IconPicker>
        )}
        saveState={saveState}
        onToggle={onToggle}
        onOpenRemove={() => dispatch({ type: 'remove/set', open: true })}
      />

      {/* Configuration */}
      <div className="flex flex-col">
        <ProfileGeneralSettings
          profile={profile}
          values={{ name, apiKey, baseUrl, api }}
          onTextFieldChange={setTextField}
          supportsModels={supportsModels}
          readOnly={false}
        />

        {supportsModels && (
          // eslint-disable-next-line ts/no-use-before-define
          <MemoizedProfileModelsSection
            loading={modelsLoading}
            models={availableModels}
            enabledModels={enabledModels}
            onChange={handleEnabledModelsChange}
            onModelRegistryMapped={handleModelRegistryMapped}
            onRefresh={handleRefreshModels}
            cachedAt={modelsCachedAt}
          />
        )}

        {supportsModels && (
          // eslint-disable-next-line ts/no-use-before-define
          <MemoizedProfileCustomModelsSection
            providerTarget={providerTarget}
            customModelsJson={profile.customModels}
            onSaved={onSaved}
            onRefreshModels={handleRefreshModels}
          />
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
  saveState,
  onToggle,
  onOpenRemove,
}: {
  profile: AgentProfile
  kindLabel: string
  icon: ReactNode
  saveState: SaveState
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
        </div>
        <p className="mt-1 truncate text-[11.5px] text-muted-foreground/80">{profile.id}</p>
      </div>

      <div className="flex items-center gap-3 pt-0.5">
        <SaveIndicator state={saveState} />

        <div className="flex items-center gap-2 rounded-full bg-muted/40 px-2.5 py-1 ring-1 ring-foreground/4">
          <Switch size="sm" checked={profile.enabled} onCheckedChange={onToggle} />
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
            <Select
              value={values.api || 'auto'}
              onValueChange={v => onTextFieldChange('api', v === 'auto' ? '' : v)}
              disabled={readOnly}
            >
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
            description={
              profile.credentialRef
                ? 'A credential is already stored. Leave empty to keep it.'
                : 'Stored locally and encrypted.'
            }
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
  models,
  enabledModels,
  onChange,
  onModelRegistryMapped,
  onRefresh,
  cachedAt,
}: {
  loading: boolean
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
  providerTarget,
  customModelsJson,
  onSaved,
  onRefreshModels,
}: {
  providerTarget: ProviderTarget
  customModelsJson: string
  onSaved: () => void
  onRefreshModels: () => void
}) {
  const queryClient = useQueryClient()
  const [models, setModels] = useState<EditableCustomModel[]>(() =>
    CustomModelsJsonSchema.parse(customModelsJson))

  // Sync from props when profile changes
  useEffect(() => {
    setModels(CustomModelsJsonSchema.parse(customModelsJson))
  }, [customModelsJson])

  const saveCustomModels = useCallback(
    async (next: EditableCustomModel[]) => {
      setModels(next)
      try {
        setModels(await updateProviderTargetCustomModels(providerTarget, next))
        void queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY })
        onRefreshModels()
        onSaved()
      }
 catch (error) {
        toastManager.add({
          type: 'error',
          title: 'Save failed',
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    },
    [providerTarget, queryClient, onSaved, onRefreshModels],
  )

  return (
    <>
      <Separator className="bg-foreground/6" />
      <section className="mt-4 flex flex-col gap-4">
        <CustomModelsEditor models={models} onChange={saveCustomModels} />
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
will be disconnected from
            every agent that uses it. Stored credentials will be deleted from this machine. You can
            always add it back later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
          <AlertDialogAction size="sm" variant="destructive" onClick={onConfirm}>
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
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
