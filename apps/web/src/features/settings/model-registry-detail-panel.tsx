import { useMutation, useQueryClient } from '@tanstack/react-query'
import { DatabaseIcon, PencilIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getModelRegistryMappingsQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { deleteModelRegistryMappingsByModelId } from '~/api-gen/sdk.gen'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Separator } from '~/components/ui/separator'
import { Spinner } from '~/components/ui/spinner'
import { toastManager } from '~/components/ui/toast'
import { cn } from '~/lib/cn'
import { formatTokenCount } from '~/lib/number-format'

import { ModelRegistryMappingDialog } from '../model-registry/mapping-dialog'
import type { ModelRegistryMapping } from '../model-registry/schemas'
import { SettingsRow } from './settings-row'

type SettingsKey = keyof typeof import('~/locales/default').default.settings

interface ModelRegistryDetailPanelProps {
  mapping: ModelRegistryMapping
  onDeleted: () => void
}

export function ModelRegistryDetailPanel({ mapping, onDeleted }: ModelRegistryDetailPanelProps) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const [mappingDialogOpen, setMappingDialogOpen] = useState(false)

  const deleteMapping = useMutation({
    mutationFn: async (id: string) => {
      await deleteModelRegistryMappingsByModelId({
        path: { modelId: id },
        throwOnError: true,
      })
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('registry.status.deleted' as SettingsKey) })
      void queryClient.invalidateQueries({ queryKey: getModelRegistryMappingsQueryKey() })
      onDeleted()
    },
    onError: (error) => {
      toastManager.add({
        type: 'error',
        title: t('registry.status.deleteFailed' as SettingsKey),
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })

  return (
    <div data-testid="model-registry-detail-panel" className="flex flex-col gap-5">
      {/* Header */}
      <header className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
          <DatabaseIcon className="size-4 text-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate font-mono text-[15px] font-medium tracking-tight text-foreground">
              {mapping.modelId}
            </h4>
            <Badge
              variant="outline"
              className={cn(
                'h-4 px-1.5 text-[9px] font-normal',
                mapping.matchType === 'manual'
                  ? 'border-blue-500/30 text-blue-600 dark:text-blue-400'
                  : 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400',
              )}
            >
              {t(`registry.match.${mapping.matchType}` as SettingsKey)}
            </Badge>
          </div>
          <p className="mt-1 truncate text-[11.5px] text-muted-foreground/80">
            {mapping.model?.name ?? mapping.registryModelId}
          </p>
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => setMappingDialogOpen(true)}
          aria-label={t('registry.action.edit' as SettingsKey)}
        >
          <PencilIcon className="size-3.5" />
        </Button>
      </header>

      {/* Detail rows */}
      <div className="flex flex-col gap-0">
        <SettingsRow
          label={t('registry.detail.registryModelId' as SettingsKey)}
          description={t('registry.detail.registryModelIdDesc' as SettingsKey)}
        >
          <span className="font-mono text-[12px] text-foreground">{mapping.registryModelId}</span>
        </SettingsRow>

        <SettingsRow
          label={t('registry.detail.createdAt' as SettingsKey)}
          description={t('registry.detail.createdAtDesc' as SettingsKey)}
        >
          <span className="text-[12px] text-foreground">
            {new Date(mapping.createdAt * 1000).toLocaleDateString()}
          </span>
        </SettingsRow>

        {mapping.model?.family && (
          <SettingsRow
            label={t('registry.detail.family' as SettingsKey)}
            description={t('registry.detail.familyDesc' as SettingsKey)}
          >
            <span className="text-[12px] text-foreground">{mapping.model.family}</span>
          </SettingsRow>
        )}

        {mapping.model?.limit?.context && (
          <SettingsRow
            label={t('registry.detail.contextWindow' as SettingsKey)}
            description={t('registry.detail.contextWindowDesc' as SettingsKey)}
          >
            <span className="font-mono text-[12px] text-foreground">
              {formatTokenCount(mapping.model.limit.context)}
            </span>
          </SettingsRow>
        )}

        {mapping.model?.cost
          && (mapping.model.cost.input != null || mapping.model.cost.output != null) && (
            <SettingsRow
              label={t('registry.detail.cost' as SettingsKey)}
              description={t('registry.detail.costDesc' as SettingsKey)}
            >
              <div className="flex flex-col gap-0.5 text-[12px] text-foreground">
                {mapping.model.cost.input != null && (
<span>
$
{mapping.model.cost.input}
/1M in
</span>
)}
                {mapping.model.cost.output != null && (
                  <span>
$
{mapping.model.cost.output}
/1M out
                  </span>
                )}
              </div>
            </SettingsRow>
          )}
      </div>

      {/* Delete action */}
      <Separator className="bg-foreground/6" />
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="destructive"
          onClick={() => deleteMapping.mutate(mapping.modelId)}
          disabled={deleteMapping.isPending}
        >
          {deleteMapping.isPending ? <Spinner className="size-3.5" /> : null}
          {t('registry.action.delete' as SettingsKey)}
        </Button>
      </div>

      {/* Mapping dialog for manual entries */}
      <ModelRegistryMappingDialog
        open={mappingDialogOpen}
        onOpenChange={setMappingDialogOpen}
        modelId={mapping.modelId}
        modelLabel={mapping.model?.name}
        initialSearchQuery={mapping.registryModelId}
        initialMode="manual"
        initialRegistryModel={mapping.model}
      />
    </div>
  )
}
