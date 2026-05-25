// Output: Read-only detail panel for external provider records in Provider settings.
// Input: External provider record/source metadata plus provider-target-backed health and model fetch.
// Position: Keeps source-owned fields read-only while exposing Cradle-owned runtime target preferences.

import { useMutation, useQueryClient } from '@tanstack/react-query'
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

import {
  getExternalProviderSourcesBySourceKeyRecordsByExternalRecordIdRuntimeTargetOptions,
  getProvidersTargetsByProviderTargetIdModelsCacheOptions,
  patchExternalProviderSourcesBySourceKeyRecordsByExternalRecordIdRuntimeTargetMutation,
  postProvidersHealthCheckMutation,
  postProvidersModelsMutation
} from '~/api-gen/@tanstack/react-query.gen'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Separator } from '~/components/ui/separator'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { toastManager } from '~/components/ui/toast'
import { AGENT_MODELS_QUERY_KEY } from '~/features/agent-runtime/use-agent-models'
import { cn } from '~/lib/cn'
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

const ExternalRecordMetadataSchema = z.object({
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  apiFormat: z.string().optional()
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

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function toRuntimeTargetView(target: {
  id: string
  sourceKey: string
  externalRecordId: string
  providerKind: 'openai-compatible' | 'anthropic'
  displayName: string
  enabled: boolean
  credentialRef: unknown | null
  iconSlug: unknown | null
  lastResolvedFingerprint: string
  createdAt: number
  updatedAt: number
}): ExternalProviderRuntimeTargetView {
  return {
    ...target,
    credentialRef: nullableString(target.credentialRef),
    iconSlug: nullableString(target.iconSlug)
  }
}

function createProviderTargetRequestBody(record: ExternalProviderRecordView) {
  return {
    providerKind: record.providerKind,
    label: record.name,
    config: {},
    secretRef: null,
    providerTargetKind: 'external',
    providerTargetId: record.providerTargetId
  }
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
  const updateRuntimeTarget = useMutation(
    patchExternalProviderSourcesBySourceKeyRecordsByExternalRecordIdRuntimeTargetMutation()
  )
  const checkHealth = useMutation(postProvidersHealthCheckMutation())
  const fetchModels = useMutation(postProvidersModelsMutation())
  const providerTarget = useMemo(
    () =>
      record.providerTargetId
        ? ({ kind: 'external' as const, id: record.providerTargetId })
        : null,
    [record.providerTargetId]
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
      queryClient
        .fetchQuery(
          getExternalProviderSourcesBySourceKeyRecordsByExternalRecordIdRuntimeTargetOptions({
            path: {
              sourceKey: record.sourceKey,
              externalRecordId: record.externalId
            }
          })
        )
        .then((next) => {
          if (active) {
            setRuntimeTarget(toRuntimeTargetView(next))
          }
        }),
      providerTarget
        ? Promise.all([
            queryClient
              .fetchQuery(
                getProvidersTargetsByProviderTargetIdModelsCacheOptions({
                  path: { providerTargetId: providerTarget.id }
                })
              )
              .then((next) => {
                if (active) {
                  setModels(next.models as ModelDescriptor[])
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
          ])
        : Promise.resolve()
    ]).finally(() => {
      if (active) {
        setLoadingTarget(false)
      }
    })

    return () => {
      active = false
    }
  }, [providerTarget, queryClient, record.externalId, record.sourceKey])

  const refreshHealth = useCallback(async () => {
    if (!providerTarget) {
      return
    }
    setHealth('checking')
    try {
      const result = await checkHealth.mutateAsync({
        body: createProviderTargetRequestBody(record)
      })
      setHealth(result.ok ? 'connected' : 'failed')
    } catch (error) {
      setHealth('failed')
      toastManager.add({
        type: 'error',
        title: 'Health check failed',
        description: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }, [checkHealth, providerTarget, record])

  const refreshModels = useCallback(async () => {
    if (!providerTarget) {
      return
    }
    setLoadingModels(true)
    try {
      const next = await fetchModels.mutateAsync({
        body: createProviderTargetRequestBody(record)
      })
      setModels(next as ModelDescriptor[])
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
  }, [fetchModels, providerTarget, queryClient, record])

  const handleEnabledModelsChange = useCallback(
    async (next: string[]) => {
      const previous = enabledModels
      if (!providerTarget) {
        return
      }
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
      if (!providerTarget) {
        return
      }
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
        const next = await updateRuntimeTarget.mutateAsync({
          path: {
            sourceKey: record.sourceKey,
            externalRecordId: record.externalId
          },
          body: { enabled }
        })
        setRuntimeTarget(toRuntimeTargetView(next))
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
    [onUpdated, record.externalId, record.sourceKey, updateRuntimeTarget]
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
    return 'Not checked'
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

        {providerTarget && (
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
        )}

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
