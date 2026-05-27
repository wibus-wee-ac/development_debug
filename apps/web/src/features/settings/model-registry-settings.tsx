// Output: Settings page for global model registry mappings.
// Input: Cradle model IDs, models.dev search results, and optional manual registry JSON.
// Position: Settings-owned UI for Cradle global model enrichment ownership.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DatabaseIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import {
  deleteModelRegistryMappingsByModelId,
  getModelRegistryMappings,
  postProvidersModelSearch,
  putModelRegistryMappingsByModelId,
} from '~/api-gen/sdk.gen'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { Textarea } from '~/components/ui/textarea'
import { cn } from '~/lib/cn'

import { SettingsDivider, SettingsRow, SettingsSectionHeader } from './settings-row'

const MODEL_REGISTRY_MAPPINGS_QUERY_KEY = ['model-registry', 'mappings'] as const

const ModelsDevModelSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().optional(),
    limit: z
      .object({
        context: z.number().optional(),
        output: z.number().optional(),
      })
      .optional(),
    modalities: z
      .object({
        input: z.array(z.string()).optional(),
        output: z.array(z.string()).optional(),
      })
      .optional(),
    reasoning: z.boolean().optional(),
    tool_call: z.boolean().optional(),
    temperature: z.boolean().optional(),
    structured_output: z.boolean().optional(),
    cost: z
      .object({
        input: z.number().optional(),
        output: z.number().optional(),
        cache_read: z.number().optional(),
        cache_write: z.number().optional(),
      })
      .optional(),
    family: z.string().optional(),
    knowledge: z.string().optional(),
    release_date: z.string().optional(),
  })
  .passthrough()

const ModelRegistryMappingSchema = z.object({
  modelId: z.string(),
  registryModelId: z.string(),
  matchType: z.enum(['manual', 'alias']),
  model: ModelsDevModelSchema.optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

const ModelRegistryMappingListSchema = z.array(ModelRegistryMappingSchema)

const SearchResultSchema = z.object({
  id: z.string(),
  label: z.string(),
  capabilities: z
    .object({
      contextWindow: z.number().optional(),
    })
    .passthrough()
    .default({}),
})

const SearchResultListSchema = z.array(SearchResultSchema)

type SearchResult = z.infer<typeof SearchResultSchema>

function formatTokens(value: number | undefined): string | null {
  if (value == null || value <= 0) {
    return null
  }
  return `${Math.round(value / 1000)}k`
}

async function searchModels(query: string): Promise<SearchResult[]> {
  const { data } = await postProvidersModelSearch({
    body: { query },
    throwOnError: true,
  })
  return SearchResultListSchema.parse(data)
}

export function ModelRegistrySettings() {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const [modelId, setModelId] = useState('')
  const [registryModelId, setRegistryModelId] = useState('')
  const [manualJson, setManualJson] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  const { data: mappings = [], isLoading } = useQuery({
    queryKey: MODEL_REGISTRY_MAPPINGS_QUERY_KEY,
    queryFn: async () => {
      const { data } = await getModelRegistryMappings({ throwOnError: true })
      return ModelRegistryMappingListSchema.parse(data)
    },
  })

  const { data: searchResults = [], isFetching: searching } = useQuery({
    queryKey: ['model-registry', 'search', query.trim()],
    enabled: query.trim().length > 0,
    queryFn: () => searchModels(query.trim()),
    staleTime: 60_000,
  })

  const filteredMappings = useMemo(() => {
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
  }, [mappings, query])

  const saveMapping = useMutation({
    mutationFn: async (input: {
      modelId: string
      registryModelId: string
      matchType: 'manual' | 'alias'
      model?: z.infer<typeof ModelsDevModelSchema>
    }) => {
      const { data } = await putModelRegistryMappingsByModelId({
        path: { modelId: input.modelId },
        body: input,
        throwOnError: true,
      })
      return ModelRegistryMappingSchema.parse(data)
    },
    onSuccess: () => {
      setStatus(t('registry.status.saved'))
      setManualJson('')
      void queryClient.invalidateQueries({ queryKey: MODEL_REGISTRY_MAPPINGS_QUERY_KEY })
    },
    onError: error => setStatus(error instanceof Error ? error.message : String(error)),
  })

  const deleteMapping = useMutation({
    mutationFn: async (id: string) => {
      await deleteModelRegistryMappingsByModelId({
        path: { modelId: id },
        throwOnError: true,
      })
    },
    onSuccess: () => {
      setStatus(t('registry.status.deleted'))
      void queryClient.invalidateQueries({ queryKey: MODEL_REGISTRY_MAPPINGS_QUERY_KEY })
    },
    onError: error => setStatus(error instanceof Error ? error.message : String(error)),
  })

  const addAlias = () => {
    const sourceId = modelId.trim()
    const targetId = registryModelId.trim()
    if (!sourceId || !targetId) {
      return
    }
    saveMapping.mutate({
      modelId: sourceId,
      registryModelId: targetId,
      matchType: 'alias',
    })
  }

  const addManual = () => {
    const sourceId = modelId.trim()
    if (!sourceId || !manualJson.trim()) {
      return
    }
    try {
      const model = ModelsDevModelSchema.parse(JSON.parse(manualJson))
      saveMapping.mutate({
        modelId: sourceId,
        registryModelId: model.id,
        matchType: 'manual',
        model,
      })
    }
    catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  const applySearchResult = (result: SearchResult) => {
    const sourceId = modelId.trim() || result.id
    saveMapping.mutate({
      modelId: sourceId,
      registryModelId: result.id,
      matchType: 'alias',
    })
    setRegistryModelId(result.id)
  }

  const busy = saveMapping.isPending || deleteMapping.isPending

  return (
    <div className="flex h-full min-h-0 flex-col gap-0" data-testid="model-registry-settings">
      <SettingsSectionHeader
        title={t('registry.page.title')}
        description={t('registry.page.description')}
        action={<Badge variant="outline">{mappings.length}</Badge>}
      />

      <Alert className="mb-4">
        <DatabaseIcon className="size-4" aria-hidden="true" />
        <AlertTitle>{t('registry.alert.title')}</AlertTitle>
        <AlertDescription>{t('registry.alert.description')}</AlertDescription>
      </Alert>

      <SettingsDivider />
      <SettingsRow
        vertical
        label={t('registry.add.label')}
        description={t('registry.add.description')}
      >
        <div className="grid gap-2">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <Input
              value={modelId}
              onChange={event => setModelId(event.target.value)}
              placeholder={t('registry.field.modelId')}
              className="font-mono text-[12px]"
            />
            <Input
              value={registryModelId}
              onChange={event => setRegistryModelId(event.target.value)}
              placeholder={t('registry.field.registryModelId')}
              className="font-mono text-[12px]"
            />
            <Button
              type="button"
              size="sm"
              onClick={addAlias}
              disabled={!modelId.trim() || !registryModelId.trim() || busy}
            >
              <PlusIcon className="size-3.5" aria-hidden="true" />
              {t('registry.action.saveAlias')}
            </Button>
          </div>
          <Textarea
            value={manualJson}
            onChange={event => setManualJson(event.target.value)}
            placeholder={t('registry.field.manualJson')}
            className="min-h-24 font-mono text-[12px]"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">
              {t('registry.manual.description')}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addManual}
              disabled={!modelId.trim() || !manualJson.trim() || busy}
            >
              {saveMapping.isPending ? <Spinner className="size-3.5" /> : <PlusIcon className="size-3.5" aria-hidden="true" />}
              {t('registry.action.saveManual')}
            </Button>
          </div>
        </div>
      </SettingsRow>

      <SettingsDivider />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
        <section className="flex min-h-0 flex-col gap-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={t('registry.search.placeholder')}
              className="pl-8 text-[12.5px]"
            />
          </div>
          <div className="min-h-0 overflow-y-auto rounded-lg ring-1 ring-foreground/6">
            {isLoading
? (
              <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-muted-foreground">
                <Spinner className="size-3.5" />
                {t('registry.loading')}
              </div>
            )
: filteredMappings.length === 0
? (
              <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">
                {t('registry.empty')}
              </div>
            )
: (
              <ul className="divide-y divide-foreground/5">
                {filteredMappings.map(mapping => (
                  <li key={mapping.modelId} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[12px] text-foreground">
                        {mapping.modelId}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {mapping.model?.name ?? mapping.registryModelId}
                      </div>
                    </div>
                    <Badge
                      variant="secondary"
                      className={cn(
                        'text-[10px] font-normal',
                        mapping.matchType === 'manual'
                          ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
                          : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                      )}
                    >
                      {t(`registry.match.${mapping.matchType}`)}
                    </Badge>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      aria-label={t('registry.action.delete')}
                      disabled={deleteMapping.isPending}
                      onClick={() => deleteMapping.mutate(mapping.modelId)}
                    >
                      <Trash2Icon className="size-3.5" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="flex min-h-0 flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12.5px] font-medium text-foreground">
              {t('registry.search.results')}
            </p>
            {searching && <Spinner className="size-3.5 text-muted-foreground" />}
          </div>
          <div className="min-h-0 overflow-y-auto rounded-lg ring-1 ring-foreground/6">
            {searchResults.length === 0
? (
              <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">
                {t('registry.search.empty')}
              </div>
            )
: (
              <ul className="divide-y divide-foreground/5">
                {searchResults.map(result => (
                  <li key={result.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => applySearchResult(result)}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent disabled:opacity-60"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium text-foreground">
                          {result.label}
                        </div>
                        <div className="truncate font-mono text-[10.5px] text-muted-foreground">
                          {result.id}
                        </div>
                      </div>
                      {formatTokens(result.capabilities.contextWindow) && (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {formatTokens(result.capabilities.contextWindow)}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {status && (
        <div className="pb-3 text-[12px] text-muted-foreground" role="status">
          {status}
        </div>
      )}
    </div>
  )
}
