import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRightIcon, DatabaseIcon, PlusIcon, SearchIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getModelRegistryMappingsOptions,
  getModelRegistryMappingsQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import { deleteModelRegistryMappingsByModelId } from '~/api-gen/sdk.gen'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'
import { Input } from '~/components/ui/input'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Separator } from '~/components/ui/separator'
import { Spinner } from '~/components/ui/spinner'
import { toastManager } from '~/components/ui/toast'
import { cn } from '~/lib/cn'

import { ModelRegistryMappingDialog } from '../model-registry/mapping-dialog'
import { ModelRegistryDetailPanel } from './model-registry-detail-panel'

type SettingsKey = keyof typeof import('~/locales/default').default.settings

export function ModelRegistrySettings() {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [selectedMappingId, setSelectedMappingId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const { data: mappings = [], isLoading } = useQuery(getModelRegistryMappingsOptions())

  const filteredMappings = (() => {
    const needle = query.trim().toLowerCase()
    if (!needle) {
      return mappings
    }
    return mappings.filter(
      mapping =>
        mapping.modelId.toLowerCase().includes(needle)
        || mapping.registryModelId.toLowerCase().includes(needle)
        || mapping.model?.name?.toLowerCase().includes(needle),
    )
  })()

  const selectedMapping = mappings.find(m => m.modelId === selectedMappingId) ?? null

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
    <div
      data-testid="model-registry-settings"
      className="flex h-full min-h-0 flex-col overflow-hidden"
    >
      {/* Header */}
      <header className="flex min-w-0 shrink-0 flex-wrap items-start justify-between gap-3 pb-5">
        <div className="min-w-0 flex-1 space-y-1">
          <h3 className="font-heading text-[15px] font-medium tracking-tight text-foreground text-balance">
            {t('registry.page.title' as SettingsKey)}
          </h3>
          <p className="max-w-full break-words text-[12.5px] leading-relaxed text-muted-foreground text-pretty">
            {t('registry.page.description' as SettingsKey)}
{' '}
            {t('registry.alert.description' as SettingsKey)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Badge variant="outline">{mappings.length}</Badge>
          <Button data-testid="add-mapping-btn" size="sm" onClick={() => setDialogOpen(true)}>
            <PlusIcon className="size-3.5" aria-hidden="true" />
            {t('registry.add.label' as SettingsKey)}
          </Button>
        </div>
      </header>

      <Separator className="shrink-0 bg-foreground/6" />

      {/* Master-Detail Grid */}
      <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr] gap-0 overflow-hidden">
        {/* Left Panel */}
        <aside className="flex flex-col gap-3 overflow-y-auto border-r border-foreground/6 py-4 pr-4">
          {/* Search */}
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('registry.search.placeholder' as SettingsKey)}
              className="h-8 pl-8 pr-2 text-[12.5px]"
            />
          </div>

          {/* Mapping list */}
          <ScrollArea className="-mx-1 flex-1">
            <div className="flex flex-col gap-0.5 px-1">
              {isLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-muted-foreground">
                  <Spinner className="size-3.5" />
                  {t('registry.loading' as SettingsKey)}
                </div>
              ) : filteredMappings.length === 0 ? (
                <div className="px-2 py-6 text-center">
                  <p className="text-[11.5px] text-muted-foreground/70">
                    {query
                      ? t('registry.search.noMatches' as SettingsKey)
                      : t('registry.empty' as SettingsKey)}
                  </p>
                </div>
              ) : (
                filteredMappings.map((mapping) => {
                  const active = mapping.modelId === selectedMappingId
                  return (
                    <div
                      key={mapping.modelId}
                      data-testid={`mapping-row-${mapping.modelId}`}
                      className={cn(
                        'group/sidebar-row flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none',
                        'transition-[background-color,opacity,scale] duration-150',
                        // 'focus-within:ring-2 focus-within:ring-ring/50',
                        active
                          ? 'bg-accent text-accent-foreground'
                          : 'hover:bg-foreground/[0.035] active:bg-foreground/6',
                      )}
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
                        onClick={() => setSelectedMappingId(mapping.modelId)}
                      >
                        <DatabaseIcon className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                'block truncate font-mono text-[12.5px] leading-tight',
                                active ? 'font-medium text-foreground' : 'text-foreground/90',
                              )}
                            >
                              {mapping.modelId}
                            </span>
                            <Badge
                              variant="outline"
                              className={cn(
                                'h-4 shrink-0 px-1.5 text-[9px] font-normal',
                                mapping.matchType === 'manual'
                                  ? 'border-blue-500/30 text-blue-600 dark:text-blue-400'
                                  : 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400',
                              )}
                            >
                              {t(`registry.match.${mapping.matchType}` as SettingsKey)}
                            </Badge>
                          </div>
                          <span className="block truncate text-[10.5px] leading-tight text-muted-foreground/70">
                            {mapping.model?.name ?? mapping.registryModelId}
                          </span>
                        </div>
                        <ChevronRightIcon
                          className={cn(
                            'size-3 shrink-0 text-muted-foreground/40 transition-[opacity,transform] duration-150',
                            active
                              ? 'opacity-100 translate-x-0'
                              : 'opacity-0 -translate-x-1 group-hover/sidebar-row:opacity-60 group-hover/sidebar-row:translate-x-0',
                          )}
                        />
                      </button>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        aria-label={t('registry.action.delete' as SettingsKey)}
                        disabled={deleteMapping.isPending}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (selectedMappingId === mapping.modelId) {
                            setSelectedMappingId(null)
                          }
                          deleteMapping.mutate(mapping.modelId)
                        }}
                      >
                        <Trash2Icon className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  )
                })
              )}
            </div>
          </ScrollArea>

          {/* Footer summary */}
          {mappings.length > 0 && (
            <div className="shrink-0 px-1 pt-1 text-[10.5px] tabular-nums text-muted-foreground/60">
              {mappings.length}
{' '}
{mappings.length === 1 ? 'mapping' : 'mappings'}
              {' · '}
              {mappings.filter(m => m.matchType === 'alias').length}
              {' alias · '}
              {mappings.filter(m => m.matchType === 'manual').length}
              {' manual'}
            </div>
          )}
        </aside>

        {/* Right Panel */}
        <section className="flex flex-col overflow-y-auto py-4 pl-6 pr-2">
          {selectedMapping
? (
            <div key={`${selectedMapping.modelId}:${selectedMapping.updatedAt}`} className="flex-1">
              <ModelRegistryDetailPanel
                mapping={selectedMapping}
                onDeleted={() => setSelectedMappingId(null)}
              />
            </div>
          )
: (
            <div className="flex flex-1 items-center justify-center">
              <Empty className="border-none">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <DatabaseIcon />
                  </EmptyMedia>
                  <EmptyTitle>{t('registry.noSelection.title' as SettingsKey)}</EmptyTitle>
                  <EmptyDescription>
                    {t('registry.noSelection.description' as SettingsKey)}
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
                    <PlusIcon className="size-3.5" aria-hidden="true" />
                    {t('registry.add.label' as SettingsKey)}
                  </Button>
                </EmptyContent>
              </Empty>
            </div>
          )}
        </section>
      </div>

      {/* Add Mapping Dialog */}
      <ModelRegistryMappingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        modelId=""
        modelIdEditable
        onSaved={(modelId) => {
          setSelectedMappingId(modelId)
        }}
      />
    </div>
  )
}
