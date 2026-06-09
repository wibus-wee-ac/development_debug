import { useQueryClient } from '@tanstack/react-query'
import { CheckIcon, CircleAlertIcon, CopyIcon, LogInIcon, Trash2Icon, XIcon } from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import type { MutableRefObject, ReactNode } from 'react'
import { useCallback, useEffect, useEffectEvent, useReducer, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'

import {
  getProvidersTargetsByProviderTargetIdModelsCacheOptions,
  getProviderTargetsQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import {
  patchProfilesByIdIcon,
  postProvidersModels,
  postSecrets,
  putProfilesById,
} from '~/api-gen/sdk.gen'
import { ProviderIcon } from '~/components/common/provider-icons'
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
import type { AgentProfile, ModelDescriptor, ProviderTarget } from '~/features/agent-runtime/types'
import { AGENT_MODELS_QUERY_KEY } from '~/features/agent-runtime/use-agent-models'
import { cn } from '~/lib/cn'
import { nativeIpc } from '~/lib/electron'

import { SettingsDivider, SettingsRow } from '../settings/settings-row'
import { ChatgptCredentialSummary } from './chatgpt-credential-summary'
import { CustomModelsEditor } from './custom-models-editor'
import { ModelsPanel } from './models-panel'
import {
  ALL_DISABLED_SENTINEL,
  presetForProfile,
  PROVIDER_KIND_LABELS,
} from './provider-settings-utils'
import type { EditableCustomModel } from './provider-target-model-settings'
import {
  CustomModelsJsonSchema,
  updateProviderTargetCustomModels,
  updateProviderTargetModelVisibility,
} from './provider-target-model-settings'
import {
  type ChatgptCredentialLoginStart,
  useChatgptCredentialLoginActions,
  useChatgptCredentialLoginStatus,
} from './use-chatgpt-credential-login'
import { type CredentialMetadata, isChatgptCredentialMetadata, useCredentialMetadata } from './use-credential-metadata'

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
  providerKind: z.enum(['openai-compatible', 'anthropic', 'universal']),
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
  options: { useChatgptAuth?: boolean } = {},
): Record<string, unknown> {
  const { enabledModels: _, ...rest } = currentConfig
  return {
    ...rest,
    baseUrl: options.useChatgptAuth ? '' : values.baseUrl,
    model: values.model || undefined,
    api: values.api || undefined,
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
  const providerTarget: ProviderTarget = ({ kind: 'manual', id: profile.id })

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
  const latestProfileRef = useRef(profile)
  const [chatgptLoginId, setChatgptLoginId] = useState<string | null>(null)
  const [activeChatgptLogin, setActiveChatgptLogin] = useState<ChatgptCredentialLoginStart | null>(null)
  const { startLogin, cancelLogin } = useChatgptCredentialLoginActions()
  const chatgptLoginStatus = useChatgptCredentialLoginStatus(chatgptLoginId)
  const credentialMetadata = useCredentialMetadata(profile.credentialRef)

  useEffect(() => {
    latestProfileRef.current = profile
  }, [profile])

  useEffect(() => {
    const login = chatgptLoginStatus.data
    if (!login) {
      return
    }
    if (login.state === 'completed' && login.credentialRef) {
      const config = ProfileConfigJsonSchema.parse(profile.configJson)
      config.baseUrl = ''
      form.setValue('baseUrl', '', { shouldDirty: false })
      setChatgptLoginId(null)
      setActiveChatgptLogin(null)
      void putProfilesById({
        path: { id: profile.id },
        body: {
          name: profile.name,
          providerKind: profile.providerKind,
          enabled: profile.enabled,
          config,
          credentialRef: login.credentialRef,
        },
      })
        .then(() => {
          dispatch({ type: 'save/set', state: 'saved' })
          onSaved()
          void queryClient.invalidateQueries({ queryKey: getProviderTargetsQueryKey() })
          void queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY })
        })
        .catch((error) => {
          dispatch({ type: 'save/set', state: 'error' })
          console.error('[ProfileDetailPanel] ChatGPT credential save failed', error)
        })
    }
    if (login.state === 'failed') {
      setActiveChatgptLogin(null)
      dispatch({ type: 'save/set', state: 'error' })
    }
  }, [chatgptLoginStatus.data, form, onSaved, profile, queryClient])

  const handleChatgptLogin = async () => {
    try {
      const login = await startLogin.mutateAsync(`${profile.name} ChatGPT`)
      setChatgptLoginId(login.loginId)
      setActiveChatgptLogin(login)
      await navigator.clipboard?.writeText(login.userCode).catch(() => undefined)
      if (nativeIpc?.native?.openExternal) {
        void nativeIpc.native.openExternal(login.verificationUrl)
      }
      else {
        window.open(login.verificationUrl, '_blank', 'noopener,noreferrer')
      }
      dispatch({ type: 'save/set', state: 'pending' })
    }
    catch (error) {
      dispatch({ type: 'save/set', state: 'error' })
      console.error('[ProfileDetailPanel] ChatGPT login failed', error)
    }
  }

  const handleCancelChatgptLogin = async () => {
    if (!chatgptLoginId) {
      return
    }
    await cancelLogin.mutateAsync(chatgptLoginId).catch(() => undefined)
    setChatgptLoginId(null)
    setActiveChatgptLogin(null)
    dispatch({ type: 'save/set', state: 'idle' })
  }

  const setTextField = (field: ProfileTextField, value: string) => {
      form.setValue(field, value, { shouldDirty: true })
    }

  const handleEnabledModelsChange = (next: string[]) => {
      form.setValue('enabledModels', next, { shouldDirty: true })
    }

  const handleModelRegistryMapped = (next: ModelDescriptor) => {
      dispatch({ type: 'models/update-one', model: next })
      void queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY })
      onSaved()
    }

  const clearAutoSaveTimer = () => {
    clearTimer(autoSaveTimerRef)
  }

  const clearSavedClearTimer = () => {
    clearTimer(savedClearTimerRef)
  }

  useEffect(() => {
    return () => {
      clearTimer(autoSaveTimerRef)
      clearTimer(savedClearTimerRef)
    }
  }, [])

  const fetchModelsFromProvider = useCallback((requestId: number) => {
      postProvidersModels({ body: buildProviderRequestBody(latestProfileRef.current) })
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
  }, [form, profile, profileId])

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

        if (cache?.cached) {
          dispatch({
            type: 'models/loaded',
            models: cache.models,
            cachedAt: cache.models.length > 0 ? null : Date.now(),
          })
          return
        }

        fetchModelsFromProvider(requestId)
      })
      .catch(() => {
        if (requestId !== modelsRequestRef.current) {
          return
        }
        dispatch({ type: 'models/failed' })
      })
  }, [fetchModelsFromProvider, supportsModels, profile.id, queryClient])

  const handleRefreshModels = () => {
    const requestId = ++modelsRequestRef.current
    dispatch({ type: 'models/loading' })
    fetchModelsFromProvider(requestId)
  }

  const saveProfile = useEffectEvent(async () => {
    const currentValues = form.getValues()
    const requestId = ++saveRequestRef.current
    dispatch({ type: 'save/set', state: 'saving' })

    try {
      // Update model visibility via dedicated endpoint (not through profile config)
      const cleanEnabledModels = currentValues.enabledModels.filter(id => id !== ALL_DISABLED_SENTINEL)
      const allDisabledNow = currentValues.enabledModels[0] === ALL_DISABLED_SENTINEL
      const effectiveEnabledModels = allDisabledNow ? [ALL_DISABLED_SENTINEL] : cleanEnabledModels
      const previousValues = JSON.parse(savedSignatureRef.current) as { enabledModels?: string[] }
      const previousEnabledModels = previousValues.enabledModels ?? []
      if (JSON.stringify(effectiveEnabledModels) !== JSON.stringify(previousEnabledModels)) {
        await updateProviderTargetModelVisibility(
          providerTarget,
          effectiveEnabledModels,
        )
      }

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
      const useChatgptAuth = !currentValues.apiKey && isChatgptCredentialMetadata(credentialMetadata.data)

      await putProfilesById({
        path: { id: profile.id },
        body: {
          name: currentValues.name,
          providerKind: profile.providerKind,
          enabled: profile.enabled,
          config: supportsModels
            ? buildProfileConfig(currentValues, ProfileConfigJsonSchema.parse(profile.configJson), { useChatgptAuth })
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
      void queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY })
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

  const watchedSignature = JSON.stringify({
        name,
        apiKey,
        baseUrl,
        model,
        api,
        enabledModels,
      })

  // Auto-save with debounce — but skip the very first run after switching profiles
  useEffect(() => {
    if (watchedSignature === savedSignatureRef.current || saveState === 'saving') {
      return
    }

    if (saveState !== 'pending') {
      dispatch({ type: 'save/set', state: 'pending' })
    }
    clearTimer(autoSaveTimerRef)
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
  }, [saveState, watchedSignature])

  // ── Icon change handler ──
  const handleIconChange = (slug: string | null) => {
      patchProfilesByIdIcon({
        path: { id: profile.id },
        body: { iconSlug: slug },
      })
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: getProviderTargetsQueryKey() })
          onSaved()
        })
        .catch(() => {})
    }

  const kindLabel = PROVIDER_KIND_LABELS[profile.providerKind]

  return (
    <div data-testid="provider-detail-panel" className="flex flex-col gap-2">
      <ProfileDetailHeader
        profile={profile}
        kindLabel={kindLabel}
        icon={(
          <IconPicker
            value={profile.iconSlug ?? null}
            onChange={handleIconChange}
            renderIcon={(entry, className) => (
              <ProviderIcon iconSlug={entry.slug} presetId={preset.id} className={className} />
            )}
          >
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
          credentialMetadata={credentialMetadata.data ?? null}
          values={{ name, apiKey, baseUrl, api }}
          onTextFieldChange={setTextField}
          supportsModels={supportsModels}
          readOnly={false}
          chatgptLoginPending={!!chatgptLoginId}
          chatgptLoginBusy={startLogin.isPending}
          activeChatgptLogin={activeChatgptLogin}
          onChatgptLogin={handleChatgptLogin}
          onCancelChatgptLogin={handleCancelChatgptLogin}
        />

        {supportsModels && (
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
  credentialMetadata,
  values,
  onTextFieldChange,
  supportsModels,
  readOnly,
  chatgptLoginPending,
  chatgptLoginBusy,
  activeChatgptLogin,
  onChatgptLogin,
  onCancelChatgptLogin,
}: {
  profile: AgentProfile
  credentialMetadata: CredentialMetadata | null
  values: Pick<ProfileDetailFormValues, ProfileTextField>
  onTextFieldChange: (field: ProfileTextField, value: string) => void
  supportsModels: boolean
  readOnly: boolean
  chatgptLoginPending: boolean
  chatgptLoginBusy: boolean
  activeChatgptLogin: ChatgptCredentialLoginStart | null
  onChatgptLogin: () => void
  onCancelChatgptLogin: () => void
}) {
  const isUniversal = profile.providerKind === 'universal'
  const isChatgptCredential = isChatgptCredentialMetadata(credentialMetadata)

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
              placeholder="https://api.example.com/v1"
            />
          </SettingsRow>

          {!isUniversal && (
            <>
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
            </>
          )}

          <SettingsDivider />
          <ProfileCredentialSettings
            profile={profile}
            credentialMetadata={credentialMetadata}
            values={values}
            onTextFieldChange={onTextFieldChange}
            readOnly={readOnly}
            chatgptLoginPending={chatgptLoginPending}
            chatgptLoginBusy={chatgptLoginBusy}
            activeChatgptLogin={activeChatgptLogin}
            onChatgptLogin={onChatgptLogin}
            onCancelChatgptLogin={onCancelChatgptLogin}
          />

        </>
      )}
    </>
  )
}

function ProfileCredentialSettings({
  profile,
  credentialMetadata,
  values,
  onTextFieldChange,
  readOnly,
  chatgptLoginPending,
  chatgptLoginBusy,
  activeChatgptLogin,
  onChatgptLogin,
  onCancelChatgptLogin,
}: {
  profile: AgentProfile
  credentialMetadata: CredentialMetadata | null
  values: Pick<ProfileDetailFormValues, ProfileTextField>
  onTextFieldChange: (field: ProfileTextField, value: string) => void
  readOnly: boolean
  chatgptLoginPending: boolean
  chatgptLoginBusy: boolean
  activeChatgptLogin: ChatgptCredentialLoginStart | null
  onChatgptLogin: () => void
  onCancelChatgptLogin: () => void
}) {
  const isChatgptCredential = isChatgptCredentialMetadata(credentialMetadata)
  const description = isChatgptCredential
    ? 'ChatGPT account auth for Codex.'
    : profile.credentialRef
      ? 'A credential is already stored. Leave empty to keep it.'
      : 'Stored locally and encrypted.'

  return (
    <section className="py-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-[13px] font-medium text-foreground">Credential</span>
        {isChatgptCredential && (
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-medium">
            ChatGPT
          </Badge>
        )}
      </div>
      <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p>

      <div
        className={cn(
          'mt-2.5 flex w-full flex-col gap-2',
          {
            'max-w-[28rem]': !isChatgptCredential,
          },
        )}
      >
        {isChatgptCredential && credentialMetadata && (
          <ChatgptCredentialSummary credential={credentialMetadata} />
        )}
        {!isChatgptCredential && (
          <Input
            data-testid="provider-edit-apikey"
            type="password"
            value={values.apiKey}
            onChange={e => onTextFieldChange('apiKey', e.target.value)}
            disabled={readOnly}
            placeholder={profile.credentialRef ? 'Configured · type to replace' : 'sk-...'}
            className="h-9 text-[12.5px] font-mono"
          />
        )}
        {profile.providerKind === 'openai-compatible' && (
          <div className="flex flex-wrap items-center gap-2">
            {chatgptLoginPending
              ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={onCancelChatgptLogin}
                    disabled={readOnly}
                  >
                    <XIcon className="size-3" />
                    Cancel ChatGPT login
                  </Button>
                )
              : (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={onChatgptLogin}
                    disabled={readOnly || chatgptLoginBusy}
                  >
                    {chatgptLoginBusy ? <Spinner className="size-3" /> : <LogInIcon className="size-3" />}
                    {isChatgptCredential ? 'Re-login with ChatGPT' : 'Sign in with ChatGPT'}
                  </Button>
                )}
          </div>
        )}
        {activeChatgptLogin && (
          <ChatgptDeviceCodeNotice login={activeChatgptLogin} />
        )}
      </div>
    </section>
  )
}

function ChatgptDeviceCodeNotice({ login }: { login: ChatgptCredentialLoginStart }) {
  const copyCode = () => {
    void navigator.clipboard?.writeText(login.userCode).catch(() => undefined)
  }

  return (
    <div className="rounded-md border border-foreground/8 bg-muted/35 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">Device code</span>
        <Button type="button" size="xs" variant="ghost" className="h-6 px-1.5" onClick={copyCode}>
          <CopyIcon className="size-3" />
          Copy
        </Button>
      </div>
      <div className="mt-1 font-mono text-[18px] font-semibold tracking-normal text-foreground">
        {login.userCode}
      </div>
      <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
        Enter this code on the OpenAI Codex authorization page.
      </div>
    </div>
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

const MemoizedProfileModelsSection = ProfileModelsSection

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

  const saveCustomModels = async (next: EditableCustomModel[]) => {
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
    }

  return (
    <>
      <Separator className="bg-foreground/6" />
      <section className="mt-4 flex flex-col gap-4">
        <CustomModelsEditor models={models} onChange={saveCustomModels} />
      </section>
    </>
  )
}

const MemoizedProfileCustomModelsSection = ProfileCustomModelsSection

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
