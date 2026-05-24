// Output: Read-only detail panel for external provider records in Provider settings.
// Input: External provider record/source metadata plus provider-target-backed health and model fetch.
// Position: Keeps source-owned fields read-only while exposing Cradle-owned runtime target preferences.

import { useQueryClient } from '@tanstack/react-query'
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  TriangleAlertIcon
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { z } from 'zod'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Separator } from '~/components/ui/separator'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { toastManager } from '~/components/ui/toast'
import { AGENT_MODELS_QUERY_KEY } from '~/features/agent-runtime/use-agent-models'
import { cn } from '~/lib/cn'
import { getServerUrl } from '~/lib/electron'
import type { ModelDescriptor } from '~/lib/types'

import { SettingsRow } from '../settings/settings-row'
import { CustomModelsEditor } from './custom-models-editor'
import { ModelsPanel } from './models-panel'
import { ProviderIcon } from './provider-icons'
import type {
  ExternalProviderRecordView,
  ExternalProviderRuntimeTargetView,
  ExternalProviderSourceView
} from './provider-settings-utils'
import { presetForProviderKind, PROVIDER_KIND_LABELS } from './provider-settings-utils'
import {
  CustomModelsJsonSchema,
  enabledModelsFromConfig,
  loadProviderTargetModelSettings,
  type EditableCustomModel,
  updateProviderTargetCustomModels,
  updateProviderTargetModelVisibility
} from './provider-target-model-settings'

type HealthState = 'unknown' | 'checking' | 'connected' | 'failed'

const ExternalProviderRuntimeTargetSchema = z.object({
  id: z.string(),
  sourceKey: z.string(),
  externalRecordId: z.string(),
  providerKind: z.enum(['openai-compatible', 'anthropic']),
  displayName: z.string(),
  enabled: z.boolean(),
  credentialRef: z.string().nullable(),
  iconSlug: z.string().nullable(),
  lastResolvedFingerprint: z.string(),
  createdAt: z.number(),
  updatedAt: z.number()
})

const ExternalRecordMetadataSchema = z.object({
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  apiFormat: z.string().optional()
})

const ModelCapabilitiesSchema = z
  .object({
    contextWindow: z.number().optional()
  })
  .passthrough()

const ModelDescriptorSchema = z.object({
  id: z.string(),
  label: z.string(),
  providerKind: z.enum(['openai-compatible', 'anthropic']),
  capabilities: ModelCapabilitiesSchema.default({})
})

const ModelDescriptorListSchema = z.array(ModelDescriptorSchema).default([])

const ProviderModelsCacheSchema = z.object({
  models: ModelDescriptorListSchema,
  cached: z.boolean(),
  stale: z.boolean(),
  providerLabel: z.string()
})

const ProviderHealthCheckSchema = z.object({
  ok: z.boolean(),
  label: z.string(),
  version: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
  errorText: z.string().nullable()
})

function sourceStatusTone(status: ExternalProviderSourceView['lastSyncStatus']) {
  if (status === 'error') {
    return 'text-destructive'
  }
  if (status === 'warning') {
    return 'text-warning'
  }
  if (status === 'ok') {
    return 'text-success'
  }
  return 'text-muted-foreground'
}

function sourceStatusIcon(status: ExternalProviderSourceView['lastSyncStatus']) {
  if (status === 'error') {
    return <CircleAlertIcon className="size-3.5 shrink-0 text-destructive" />
  }
  if (status === 'warning') {
    return <TriangleAlertIcon className="size-3.5 shrink-0 text-warning" />
  }
  if (status === 'ok') {
    return <CircleCheckIcon className="size-3.5 shrink-0 text-success" />
  }
  return <CircleDashedIcon className="size-3.5 shrink-0 text-muted-foreground" />
}

async function loadRuntimeTarget(
  record: ExternalProviderRecordView
): Promise<ExternalProviderRuntimeTargetView> {
  const response = await fetch(
    `${getServerUrl()}/external-provider-sources/${encodeURIComponent(record.sourceKey)}/records/${encodeURIComponent(record.externalId)}/runtime-target`
  )
  if (!response.ok) {
    throw new Error('Failed to load external runtime target')
  }
  return ExternalProviderRuntimeTargetSchema.parse(await response.json())
}

async function updateRuntimeTargetEnabled(
  record: ExternalProviderRecordView,
  enabled: boolean
): Promise<ExternalProviderRuntimeTargetView> {
  const response = await fetch(
    `${getServerUrl()}/external-provider-sources/${encodeURIComponent(record.sourceKey)}/records/${encodeURIComponent(record.externalId)}/runtime-target`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    }
  )
  if (!response.ok) {
    throw new Error('Failed to update external runtime target')
  }
  return ExternalProviderRuntimeTargetSchema.parse(await response.json())
}

async function loadCachedModels(recordId: string): Promise<ModelDescriptor[]> {
  const response = await fetch(
    `${getServerUrl()}/providers/targets/external-record/${encodeURIComponent(recordId)}/models-cache`
  )
  if (!response.ok) {
    throw new Error('Failed to load provider target models cache')
  }
  const payload = ProviderModelsCacheSchema.parse(await response.json())
  return payload.models
}

function createProviderTargetRequestBody(record: ExternalProviderRecordView) {
  return {
    providerKind: record.providerKind,
    label: record.name,
    config: {},
    secretRef: null,
    providerTargetKind: 'external-record',
    providerTargetId: record.id
  }
}

async function checkProviderTargetHealth(record: ExternalProviderRecordView): Promise<boolean> {
  const response = await fetch(`${getServerUrl()}/providers/health-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(createProviderTargetRequestBody(record))
  })
  if (!response.ok) {
    throw new Error('Failed to check provider target health')
  }
  return ProviderHealthCheckSchema.parse(await response.json()).ok
}

async function fetchProviderTargetModels(
  record: ExternalProviderRecordView
): Promise<ModelDescriptor[]> {
  const response = await fetch(`${getServerUrl()}/providers/models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(createProviderTargetRequestBody(record))
  })
  if (!response.ok) {
    throw new Error('Failed to fetch provider target models')
  }
  return ModelDescriptorListSchema.parse(await response.json()) satisfies ModelDescriptor[]
}

export function ExternalProviderRecordDetailPanel({
  record,
  source,
  onUpdated
}: {
  record: ExternalProviderRecordView
  source: ExternalProviderSourceView | null
  onUpdated?: () => void
}) {
  const preset = presetForProviderKind(record.providerKind)
  const metadata = ExternalRecordMetadataSchema.parse(record.metadata)
  const queryClient = useQueryClient()
  const providerTarget = useMemo(
    () => ({ kind: 'external-record' as const, id: record.id }),
    [record.id]
  )
  const [runtimeTarget, setRuntimeTarget] = useState<ExternalProviderRuntimeTargetView | null>(null)
  const [health, setHealth] = useState<HealthState>('unknown')
  const [models, setModels] = useState<ModelDescriptor[]>([])
  const [enabledModels, setEnabledModels] = useState<string[]>([])
  const [customModels, setCustomModels] = useState<EditableCustomModel[]>([])
  const [loadingTarget, setLoadingTarget] = useState(true)
  const [loadingModels, setLoadingModels] = useState(false)
  const [updatingEnabled, setUpdatingEnabled] = useState(false)

  useEffect(() => {
    let active = true
    setLoadingTarget(true)
    setModels([])
    setEnabledModels([])
    setCustomModels([])
    setHealth('unknown')
    void Promise.all([
      loadRuntimeTarget(record).then((next) => {
        if (active) {
          setRuntimeTarget(next)
        }
      }),
      loadCachedModels(record.id)
        .then((next) => {
          if (active) {
            setModels(next)
          }
        })
        .catch(() => {
          if (active) {
            setModels([])
          }
        }),
      loadProviderTargetModelSettings(providerTarget)
        .then((next) => {
          if (active) {
            setEnabledModels(enabledModelsFromConfig(next.configJson))
            setCustomModels(CustomModelsJsonSchema.parse(next.customModelsJson))
          }
        })
        .catch(() => {
          if (active) {
            setEnabledModels([])
            setCustomModels([])
          }
        })
    ]).finally(() => {
      if (active) {
        setLoadingTarget(false)
      }
    })

    return () => {
      active = false
    }
  }, [providerTarget, record])

  const refreshHealth = useCallback(async () => {
    setHealth('checking')
    try {
      setHealth((await checkProviderTargetHealth(record)) ? 'connected' : 'failed')
    } catch (error) {
      setHealth('failed')
      toastManager.add({
        type: 'error',
        title: 'Health check failed',
        description: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }, [record])

  const refreshModels = useCallback(async () => {
    setLoadingModels(true)
    try {
      setModels(await fetchProviderTargetModels(record))
      void queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY })
    } catch (error) {
      toastManager.add({
        type: 'error',
        title: 'Fetch models failed',
        description: error instanceof Error ? error.message : 'Unknown error'
      })
    } finally {
      setLoadingModels(false)
    }
  }, [queryClient, record])

  const handleEnabledModelsChange = useCallback(
    async (next: string[]) => {
      const previous = enabledModels
      setEnabledModels(next)
      try {
        const settings = await updateProviderTargetModelVisibility(providerTarget, next)
        setEnabledModels(enabledModelsFromConfig(settings.configJson))
        void queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY })
        onUpdated?.()
      } catch (error) {
        setEnabledModels(previous)
        toastManager.add({
          type: 'error',
          title: 'Save model visibility failed',
          description: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    },
    [enabledModels, onUpdated, providerTarget, queryClient]
  )

  const handleModelRegistryMapped = useCallback(
    (next: ModelDescriptor) => {
      setModels((current) => current.map((model) => (model.id === next.id ? next : model)))
      void queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY })
      onUpdated?.()
    },
    [onUpdated, queryClient]
  )

  const handleCustomModelsChange = useCallback(
    async (next: EditableCustomModel[]) => {
      const previous = customModels
      setCustomModels(next)
      try {
        setCustomModels(await updateProviderTargetCustomModels(providerTarget, next))
        void queryClient.invalidateQueries({ queryKey: AGENT_MODELS_QUERY_KEY })
        void refreshModels()
        onUpdated?.()
      } catch (error) {
        setCustomModels(previous)
        toastManager.add({
          type: 'error',
          title: 'Save custom models failed',
          description: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    },
    [customModels, onUpdated, providerTarget, queryClient, refreshModels]
  )

  const toggleEnabled = useCallback(
    async (enabled: boolean) => {
      setUpdatingEnabled(true)
      try {
        const next = await updateRuntimeTargetEnabled(record, enabled)
        setRuntimeTarget(next)
        setHealth('unknown')
        onUpdated?.()
      } catch (error) {
        toastManager.add({
          type: 'error',
          title: 'Update external target failed',
          description: error instanceof Error ? error.message : 'Unknown error'
        })
      } finally {
        setUpdatingEnabled(false)
      }
    },
    [onUpdated, record]
  )

  const healthLabel = useMemo(() => {
    if (!runtimeTarget?.enabled) {
      return 'Unavailable'
    }
    if (health === 'checking') {
      return 'Checking'
    }
    if (health === 'connected') {
      return 'Connected'
    }
    if (health === 'failed') {
      return 'Failed'
    }
    return 'Unknown'
  }, [health, runtimeTarget?.enabled])

  return (
    <div data-testid="external-provider-record-detail-panel" className="flex flex-col gap-4">
      <header className="flex items-start gap-3">
        <div className="mt-1 shrink-0 rounded-md p-0.5 text-muted-foreground">
          <ProviderIcon
            iconSlug={runtimeTarget?.iconSlug ?? null}
            presetId={preset.id}
            className="size-6"
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-heading truncate text-[15px] font-medium text-foreground">
              {runtimeTarget?.displayName ?? record.name}
            </h4>
            <Badge variant="secondary" className="font-normal text-muted-foreground">
              {PROVIDER_KIND_LABELS[record.providerKind]}
            </Badge>
            <Badge variant="outline" className="font-normal">
              External record
            </Badge>
            <Badge
              variant="secondary"
              className={cn(
                record.status === 'active' && 'text-success',
                record.status === 'missing' && 'text-warning',
                record.status === 'error' && 'text-destructive'
              )}
            >
              {record.status}
            </Badge>
          </div>
          <p className="mt-1 truncate text-[11.5px] text-muted-foreground/80">{record.id}</p>
        </div>

        <div className="flex items-center gap-2 pt-0.5">
          <Switch
            size="sm"
            checked={runtimeTarget?.enabled ?? false}
            disabled={
              loadingTarget ||
              updatingEnabled ||
              record.status === 'missing' ||
              record.status === 'unsupported'
            }
            onCheckedChange={(enabled) => void toggleEnabled(enabled)}
          />
          <Badge variant="secondary" className="font-normal">
            {healthLabel}
          </Badge>
          <Button
            size="xs"
            variant="outline"
            onClick={() => void refreshHealth()}
            disabled={loadingTarget || !runtimeTarget?.enabled || health === 'checking'}
          >
            {health === 'checking' ? (
              <Spinner className="size-3" />
            ) : (
              <RefreshCwIcon className="size-3" />
            )}
            Check
          </Button>
        </div>
      </header>

      <div className="rounded-lg border border-foreground/6 bg-foreground/[0.015] px-3 py-2 text-[12px] text-muted-foreground">
        Source fields stay in their source namespace. Model preferences below are stored on the
        Cradle runtime target.
      </div>

      <div className="flex flex-col gap-3">
        <SettingsRow label="Source" description="Plugin-owned source of truth">
          <div className="flex flex-col gap-1 text-[12px]">
            <span className="text-foreground">{source?.label ?? 'Unknown source'}</span>
            <span className="flex items-center gap-1.5">
              {sourceStatusIcon(source?.lastSyncStatus ?? 'never')}
              <span className={sourceStatusTone(source?.lastSyncStatus ?? 'never')}>
                {source?.lastSyncStatus ?? 'never'}
              </span>
            </span>
            {source?.lastSyncError && (
              <span className="text-xs text-destructive/80">{source.lastSyncError}</span>
            )}
          </div>
        </SettingsRow>

        <Separator className="bg-foreground/6" />

        <SettingsRow label="External id" description="Stable identifier from the source app">
          <span className="font-mono text-[12px] text-foreground">{record.externalId}</span>
        </SettingsRow>

        <Separator className="bg-foreground/6" />

        <SettingsRow
          label="Runtime target"
          description="Cradle-owned execution target for this record"
        >
          {loadingTarget ? (
            <Spinner className="size-4" />
          ) : (
            <div className="flex flex-col gap-1 text-[12px] text-foreground">
              <span className="font-mono">{runtimeTarget?.id ?? 'Unavailable'}</span>
              <span className="text-muted-foreground">
                Credential
                {': '}
                {runtimeTarget?.credentialRef ? 'Configured' : 'Missing'}
              </span>
            </div>
          )}
        </SettingsRow>

        <Separator className="bg-foreground/6" />

        <SettingsRow label="Scope" description="Source app and provider binding">
          <div className="flex flex-col gap-1 text-[12px] text-foreground">
            <span>{record.app}</span>
            {metadata.apiFormat && (
              <span className="text-muted-foreground">
                API format
                {': '}
                {metadata.apiFormat}
              </span>
            )}
          </div>
        </SettingsRow>

        {metadata.baseUrl && (
          <>
            <Separator className="bg-foreground/6" />
            <SettingsRow label="Base URL" description="Source-provided endpoint">
              <span className="font-mono text-[12px] text-foreground">{metadata.baseUrl}</span>
            </SettingsRow>
          </>
        )}

        {metadata.model && (
          <>
            <Separator className="bg-foreground/6" />
            <SettingsRow label="Model" description="Source-provided default model">
              <span className="font-mono text-[12px] text-foreground">{metadata.model}</span>
            </SettingsRow>
          </>
        )}

        <Separator className="bg-foreground/6" />

        <SettingsRow label="Warnings" description="Warnings reported by the source">
          <div className="flex flex-col gap-1">
            {record.warnings.length > 0 || (source?.warnings.length ?? 0) > 0 ? (
              [...record.warnings, ...(source?.warnings ?? [])].map((warning) => (
                <div
                  key={`${warning.severity}:${warning.code}:${warning.message}`}
                  className="text-[12px] text-muted-foreground"
                >
                  {warning.severity}
                  {': '}
                  {warning.message}
                </div>
              ))
            ) : (
              <span className="text-[12px] text-muted-foreground">None</span>
            )}
          </div>
        </SettingsRow>

        <Separator className="bg-foreground/6" />

        <section className="flex flex-col gap-4">
          <ModelsPanel
            loading={loadingModels || loadingTarget}
            providerTarget={providerTarget}
            models={models}
            enabledModels={enabledModels}
            onChange={(next) => void handleEnabledModelsChange(next)}
            onModelRegistryMapped={handleModelRegistryMapped}
            onRefresh={() => void refreshModels()}
            cachedAt={null}
          />
        </section>

        <Separator className="bg-foreground/6" />

        <section className="flex flex-col gap-4">
          <CustomModelsEditor
            models={customModels}
            onChange={(next) => void handleCustomModelsChange(next)}
          />
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-foreground/6 bg-background/60 p-3">
          <div className="flex items-center gap-2">
            <ExternalLinkIcon className="size-3.5 text-muted-foreground" />
            <h5 className="text-[12px] font-medium text-foreground">Inventory</h5>
          </div>
          <div className="flex flex-wrap gap-2 text-[12px] text-muted-foreground">
            {Object.entries(source?.inventory ?? {}).length === 0 ? (
              <span>None</span>
            ) : (
              Object.entries(source?.inventory ?? {}).map(([key, value]) => (
                <span key={key} className="rounded-full bg-muted px-2 py-0.5">
                  {key}
                  {': '}
                  {String(value)}
                </span>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
