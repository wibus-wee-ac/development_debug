import type { TFunction } from 'i18next'
import { RefreshCwIcon, SearchIcon, SlidersHorizontalIcon, SparklesIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import {
  postProvidersModelSearch,
  putModelRegistryMappingsByModelId,
} from '~/api-gen/sdk.gen'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { modelIsVisible, ModelVisibilitySchema } from '~/features/agent-runtime/model-visibility'
import { cn } from '~/lib/cn'
import type { ModelCapabilities, ModelDescriptor } from '~/lib/types'

import { ALL_DISABLED_SENTINEL } from './provider-settings-utils'

type TimeAgoMessage
  = | { key: 'models.time.justNow' }
    | { key: 'models.time.minutesAgo', options: { minuteCount: number } }
    | { key: 'models.time.hoursAgo', options: { hourCount: number } }
    | { key: 'models.time.daysAgo', options: { dayCount: number } }

function formatTimeAgo(ts: number): TimeAgoMessage {
  const seconds = Math.round((Date.now() - ts) / 1000)
  if (seconds < 60) {
    return { key: 'models.time.justNow' }
  }
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) {
    return { key: 'models.time.minutesAgo', options: { minuteCount: minutes } }
  }
  const hours = Math.round(minutes / 60)
  if (hours < 24) {
    return { key: 'models.time.hoursAgo', options: { hourCount: hours } }
  }
  const days = Math.round(hours / 24)
  return { key: 'models.time.daysAgo', options: { dayCount: days } }
}

function renderTimeAgo(message: TimeAgoMessage, t: TFunction<'agentManagement'>): string {
  switch (message.key) {
    case 'models.time.justNow':
      return t('models.time.justNow')
    case 'models.time.minutesAgo':
      return t('models.time.minutesAgo', message.options)
    case 'models.time.hoursAgo':
      return t('models.time.hoursAgo', message.options)
    case 'models.time.daysAgo':
      return t('models.time.daysAgo', message.options)
  }
}

function occurrenceKey(id: string, counts: Map<string, number>): string {
  const count = counts.get(id) ?? 0
  counts.set(id, count + 1)
  return `${id}:${count}`
}

interface SearchResult {
  id: string
  label: string
  capabilities: ModelCapabilities
}

const ModelCapabilitiesSchema = z
  .object({
    contextWindow: z.number().optional(),
    maxOutput: z.number().optional(),
    inputModalities: z.array(z.string()).optional(),
    outputModalities: z.array(z.string()).optional(),
    reasoning: z.boolean().optional(),
    toolCall: z.boolean().optional(),
    temperature: z.boolean().optional(),
    structuredOutput: z.boolean().optional(),
    cost: z
      .object({
        input: z.number().optional(),
        output: z.number().optional(),
        cacheRead: z.number().optional(),
        cacheWrite: z.number().optional(),
      })
      .optional(),
    family: z.string().optional(),
    knowledgeCutoff: z.string().optional(),
    releaseDate: z.string().optional(),
    registryMatch: z.enum(['exact', 'fuzzy', 'manual', 'alias', 'unmatched']).optional(),
    registryModelId: z.string().optional(),
    registryModelLabel: z.string().optional(),
  })
  .default({})

const SearchResultListSchema = z
  .array(
    z.object({
      id: z.string(),
      label: z.string(),
      capabilities: ModelCapabilitiesSchema,
    }),
  )
  .default([])

interface ManualRegistryDraft {
  id: string
  name: string
  context: string
  output: string
  inputText: boolean
  inputImage: boolean
  outputText: boolean
  reasoning: boolean
  toolCall: boolean
  temperature: boolean
  structuredOutput: boolean
  family: string
  knowledge: string
  releaseDate: string
  costInput: string
  costOutput: string
  costCacheRead: string
  costCacheWrite: string
}

const OptionalNumberTextSchema = z
  .string()
  .trim()
  .transform(value => (value === '' ? undefined : Number(value)))
  .pipe(z.number().finite().optional())

const ManualRegistryDraftProjectionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    context: OptionalNumberTextSchema,
    output: OptionalNumberTextSchema,
    inputText: z.boolean(),
    inputImage: z.boolean(),
    outputText: z.boolean(),
    reasoning: z.boolean(),
    toolCall: z.boolean(),
    temperature: z.boolean(),
    structuredOutput: z.boolean(),
    family: z
      .string()
      .trim()
      .transform(value => value || undefined),
    knowledge: z
      .string()
      .trim()
      .transform(value => value || undefined),
    releaseDate: z
      .string()
      .trim()
      .transform(value => value || undefined),
    costInput: OptionalNumberTextSchema,
    costOutput: OptionalNumberTextSchema,
    costCacheRead: OptionalNumberTextSchema,
    costCacheWrite: OptionalNumberTextSchema,
  })
  .transform(draft => ({
    id: draft.id.trim(),
    name: draft.name.trim() || draft.id.trim(),
    inputModalities: [...(draft.inputText ? ['text'] : []), ...(draft.inputImage ? ['image'] : [])],
    outputModalities: draft.outputText ? ['text'] : [],
    contextWindow: draft.context,
    maxOutput: draft.output,
    reasoning: draft.reasoning,
    toolCall: draft.toolCall,
    temperature: draft.temperature,
    structuredOutput: draft.structuredOutput,
    family: draft.family,
    knowledgeCutoff: draft.knowledge,
    releaseDate: draft.releaseDate,
    modelsDevCost: {
      input: draft.costInput,
      output: draft.costOutput,
      cache_read: draft.costCacheRead,
      cache_write: draft.costCacheWrite,
    },
    capabilitiesCost: {
      input: draft.costInput,
      output: draft.costOutput,
      cacheRead: draft.costCacheRead,
      cacheWrite: draft.costCacheWrite,
    },
  }))

function createManualDraft(model: ModelDescriptor | null, query: string): ManualRegistryDraft {
  const id = query.trim() || model?.capabilities.registryModelId || model?.id || ''
  return {
    id,
    name: model?.label && model.label !== model.id ? model.label : id,
    context: model?.capabilities.contextWindow ? String(model.capabilities.contextWindow) : '',
    output: model?.capabilities.maxOutput ? String(model.capabilities.maxOutput) : '',
    inputText: true,
    inputImage: model?.capabilities.inputModalities?.includes('image') ?? false,
    outputText: true,
    reasoning: model?.capabilities.reasoning ?? false,
    toolCall: model?.capabilities.toolCall ?? true,
    temperature: model?.capabilities.temperature ?? true,
    structuredOutput: model?.capabilities.structuredOutput ?? false,
    family: model?.capabilities.family ?? '',
    knowledge: model?.capabilities.knowledgeCutoff ?? '',
    releaseDate: model?.capabilities.releaseDate ?? '',
    costInput: model?.capabilities.cost?.input != null ? String(model.capabilities.cost.input) : '',
    costOutput:
      model?.capabilities.cost?.output != null ? String(model.capabilities.cost.output) : '',
    costCacheRead:
      model?.capabilities.cost?.cacheRead != null ? String(model.capabilities.cost.cacheRead) : '',
    costCacheWrite:
      model?.capabilities.cost?.cacheWrite != null ? String(model.capabilities.cost.cacheWrite) : '',
  }
}

function buildManualModelsDevModel(draft: ManualRegistryDraft) {
  const projected = ManualRegistryDraftProjectionSchema.parse(draft)

  return {
    id: projected.id,
    name: projected.name,
    limit: {
      context: projected.contextWindow,
      output: projected.maxOutput,
    },
    modalities: { input: projected.inputModalities, output: projected.outputModalities },
    reasoning: projected.reasoning,
    tool_call: projected.toolCall,
    temperature: projected.temperature,
    structured_output: projected.structuredOutput,
    cost: projected.modelsDevCost,
    family: projected.family,
    knowledge: projected.knowledgeCutoff,
    release_date: projected.releaseDate,
  }
}

function capabilitiesFromManualDraft(draft: ManualRegistryDraft): ModelCapabilities {
  const projected = ManualRegistryDraftProjectionSchema.parse(draft)

  return {
    contextWindow: projected.contextWindow,
    maxOutput: projected.maxOutput,
    inputModalities: projected.inputModalities,
    outputModalities: projected.outputModalities,
    reasoning: projected.reasoning,
    toolCall: projected.toolCall,
    temperature: projected.temperature,
    structuredOutput: projected.structuredOutput,
    cost: projected.capabilitiesCost,
    family: projected.family,
    knowledgeCutoff: projected.knowledgeCutoff,
    releaseDate: projected.releaseDate,
  }
}

function applyRegistryResult(
  model: ModelDescriptor,
  result: SearchResult,
  match: 'manual' | 'alias',
): ModelDescriptor {
  return {
    ...model,
    label: result.label || model.label,
    capabilities: {
      ...result.capabilities,
      ...model.capabilities,
      registryMatch: match,
      registryModelId: result.id,
      registryModelLabel: result.label || result.id,
    },
  }
}

type RegistryStatus = 'exact' | 'fuzzy' | 'manual' | 'alias' | 'unmatched'

function registryStatusLabel(model: ModelDescriptor): RegistryStatus {
  switch (model.capabilities.registryMatch) {
    case 'exact':
      return 'exact'
    case 'fuzzy':
      return 'fuzzy'
    case 'manual':
      return 'manual'
    case 'alias':
      return 'alias'
    default:
      return 'unmatched'
  }
}

const REGISTRY_STATUS_KEYS = {
  exact: 'models.registry.status.exact',
  fuzzy: 'models.registry.status.fuzzy',
  manual: 'models.registry.status.manual',
  alias: 'models.registry.status.alias',
  unmatched: 'models.registry.status.unmatched',
} as const

async function searchProviderModels(query: string): Promise<SearchResult[]> {
  const { data } = await postProvidersModelSearch({
    body: { query },
    throwOnError: true,
  })
  return SearchResultListSchema.parse(data) satisfies SearchResult[]
}

export function ModelsPanel({
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
  const { t } = useTranslation('agentManagement')
  const [filter, setFilter] = useState('')
  const [mappingModel, setMappingModel] = useState<ModelDescriptor | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchPending, setSearchPending] = useState(false)
  const [savingMapping, setSavingMapping] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualDraft, setManualDraft] = useState<ManualRegistryDraft>(() =>
    createManualDraft(null, ''))
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const visibility = useMemo(() => ModelVisibilitySchema.parse(enabledModels), [enabledModels])
  const allDisabled = visibility.kind === 'none'
  const isExplicitSelection = visibility.kind === 'list'

  const visible = useMemo(() => {
    let filtered = models
    if (filter.trim()) {
      const q = filter.toLowerCase()
      filtered = models.filter(m => (m.label || m.id).toLowerCase().includes(q))
    }
    // Sort: enabled first, then alphabetical within each group
    return filtered.toSorted((a, b) => {
      const aEnabled = modelIsVisible(visibility, a.id)
      const bEnabled = modelIsVisible(visibility, b.id)
      if (aEnabled !== bEnabled) {
        return aEnabled ? -1 : 1
      }
      return (a.label || a.id).localeCompare(b.label || b.id)
    })
  }, [models, filter, visibility])

  const enabledCount
    = visibility.kind === 'none'
      ? 0
      : visibility.kind === 'all'
        ? models.length
        : models.filter(model => visibility.ids.has(model.id)).length

  const isChecked = (id: string): boolean => {
    return modelIsVisible(visibility, id)
  }

  const handleToggle = (id: string, checked: boolean) => {
    if (checked) {
      // Enabling a model
      if (allDisabled) {
        // From "all disabled" → enable only this one
        onChange([id])
      }
 else if (visibility.kind === 'all') {
        // "All enabled" state — shouldn't normally check an already-checked item,
        // but just in case, keep all enabled (no-op)
      }
 else {
        // Explicit selection — add this model
        onChange([...enabledModels, id])
      }
    }
 else {
      // Disabling a model
      const base = visibility.kind === 'all' ? models.map(m => m.id) : enabledModels
      const next = base.filter(x => x !== id)
      onChange(next.length === 0 ? [ALL_DISABLED_SENTINEL] : next)
    }
  }

  useEffect(() => {
    const query = searchQuery.trim()
    if (!mappingModel || !query) {
      setSearchResults([])
      setSearchPending(false)
      return
    }
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }
    setSearchPending(true)
    searchDebounceRef.current = setTimeout(() => {
      void searchProviderModels(query).then(
        (results) => {
          setSearchResults(results)
          setSearchPending(false)
        },
        () => {
          setSearchResults([])
          setSearchPending(false)
        },
      )
    }, 220)

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current)
      }
    }
  }, [mappingModel, searchQuery])

  const openMappingDialog = useCallback((model: ModelDescriptor) => {
    setMappingModel(model)
    setSearchQuery(model.capabilities.registryModelId ?? model.id)
    setSearchResults([])
    setManualOpen(false)
    setManualDraft(createManualDraft(model, model.capabilities.registryModelId ?? model.id))
  }, [])

  const closeMappingDialog = useCallback(() => {
    setMappingModel(null)
    setSearchQuery('')
    setSearchResults([])
    setManualOpen(false)
    setSavingMapping(false)
  }, [])

  const saveRegistryMapping = useCallback(
    async (
      model: ModelDescriptor,
      result: SearchResult,
      manualModel?: ReturnType<typeof buildManualModelsDevModel>,
    ) => {
      setSavingMapping(true)
      const body = manualModel
        ? { modelId: model.id, registryModelId: result.id, model: manualModel }
        : { modelId: model.id, registryModelId: result.id }
      try {
        await putModelRegistryMappingsByModelId({
          path: { modelId: model.id },
          body: {
            ...body,
            matchType: manualModel ? 'manual' : 'alias',
          },
          throwOnError: true,
        })
        onModelRegistryMapped(applyRegistryResult(model, result, manualModel ? 'manual' : 'alias'))
        closeMappingDialog()
      }
 finally {
        setSavingMapping(false)
      }
    },
    [closeMappingDialog, onModelRegistryMapped],
  )

  const saveManualMapping = useCallback(() => {
    if (!mappingModel || !manualDraft.id.trim()) {
      return
    }
    const manualModel = buildManualModelsDevModel(manualDraft)
    void saveRegistryMapping(
      mappingModel,
      {
        id: manualModel.id,
        label: manualModel.name,
        capabilities: capabilitiesFromManualDraft(manualDraft),
      },
      manualModel,
    )
  }, [manualDraft, mappingModel, saveRegistryMapping])

  const modelKeyCounts = new Map<string, number>()

  return (
    <div className="flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[12.5px] font-medium text-foreground">
            {t('models.header.title')}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t('models.header.description')}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {onRefresh && models.length > 0 && !loading && (
            <Button
              size="xs"
              variant="ghost"
              className="gap-1 text-[11px] text-muted-foreground"
              onClick={onRefresh}
            >
              <RefreshCwIcon className="size-3" />
              {t('models.action.refresh')}
            </Button>
          )}
          {(isExplicitSelection || allDisabled) && (
            <Button
              size="xs"
              variant="ghost"
              className="text-[11px] text-muted-foreground"
              onClick={() => onChange([])}
            >
              {t('models.action.showAll')}
            </Button>
          )}
          {!allDisabled && (
            <Button
              size="xs"
              variant="ghost"
              className="text-[11px] text-muted-foreground"
              onClick={() => onChange([ALL_DISABLED_SENTINEL])}
            >
              {t('models.action.disableAll')}
            </Button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <Input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder={t('models.search.placeholder')}
          className="h-8 pl-8 text-[12.5px]"
        />
      </div>

      {/* Body */}
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/6">
        {loading
? (
          <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-muted-foreground">
            <Spinner className="size-3" />
            {t('models.loading')}
          </div>
        )
: models.length === 0
? (
          <div className="px-4 py-8 text-center">
            <p className="text-[12px] text-muted-foreground">
              {t('models.empty.title')}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground/70">
              {t('models.empty.description')}
            </p>
            {onRefresh && (
              <Button
                size="xs"
                variant="outline"
                className="mt-3 gap-1.5 text-[11px]"
                onClick={onRefresh}
              >
                <RefreshCwIcon className="size-3" />
                {t('models.action.fetchModels')}
              </Button>
            )}
          </div>
        )
: (
          <div className="max-h-72 overflow-y-auto">
            <ul className="divide-y divide-foreground/4">
              {visible.map((m) => {
                const checked = isChecked(m.id)
                const registryStatus = registryStatusLabel(m)
                return (
                  <li key={occurrenceKey(m.id, modelKeyCounts)}>
                    <div
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 transition-colors',
                        'hover:bg-foreground/2.5',
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={c => handleToggle(m.id, !!c)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] font-medium text-foreground">
                          {m.label || m.id}
                        </div>
                        {m.label && m.label !== m.id && (
                          <div className="truncate font-mono text-[10.5px] text-muted-foreground/70">
                            {m.id}
                          </div>
                        )}
                        {m.capabilities.registryModelId
                          && m.capabilities.registryModelId !== m.id && (
                            <div className="truncate text-[10.5px] text-muted-foreground/70">
                              models.dev:
{' '}
                              <span className="font-mono">{m.capabilities.registryModelId}</span>
                            </div>
                          )}
                      </div>
                      <Badge
                        variant="secondary"
                        className={cn(
                          'text-[10px] font-normal tabular-nums',
                          registryStatus === 'exact'
                          && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                          registryStatus === 'fuzzy'
                          && 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
                          registryStatus === 'manual'
                          && 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
                          registryStatus === 'unmatched' && 'text-muted-foreground',
                        )}
                      >
                        {t(REGISTRY_STATUS_KEYS[registryStatus])}
                      </Badge>
                      {m.capabilities.contextWindow != null && m.capabilities.contextWindow > 0 && (
                        <Badge
                          variant="secondary"
                          className="font-mono text-[10px] font-normal tabular-nums text-muted-foreground"
                        >
                          {Math.round(m.capabilities.contextWindow / 1000)}
k
                        </Badge>
                      )}
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        onClick={() => openMappingDialog(m)}
                        aria-label={t('models.mapping.mapAria', { modelId: m.id })}
                        title={t('models.mapping.mapTitle')}
                        className="text-muted-foreground/60 hover:text-foreground"
                      >
                        <SparklesIcon className="size-3" aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                )
              })}
              {visible.length === 0 && (
                <li className="px-4 py-8 text-center text-[11.5px] text-muted-foreground">
                  {t('models.search.noMatches.prefix')}
{' '}
                  <span className="font-mono text-foreground">{filter}</span>
                  {t('models.search.noMatches.suffix')}
                </li>
              )}
            </ul>
          </div>
        )}
      </div>

      <Dialog
        open={mappingModel !== null && !manualOpen}
        onOpenChange={open => !open && closeMappingDialog()}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('models.mapping.dialog.title')}</DialogTitle>
            <DialogDescription>
              {t('models.mapping.dialog.description')}
            </DialogDescription>
          </DialogHeader>

          {mappingModel && (
            <div className="flex flex-col gap-3">
              <div className="rounded-lg bg-muted/40 px-3 py-2">
                <div className="truncate text-[12.5px] font-medium text-foreground">
                  {mappingModel.label || mappingModel.id}
                </div>
                <div className="truncate font-mono text-[10.5px] text-muted-foreground">
                  {mappingModel.id}
                </div>
              </div>

              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
                <Input
                  value={searchQuery}
                  onChange={event => setSearchQuery(event.target.value)}
                  placeholder={t('models.mapping.search.placeholder')}
                  className="h-8 pl-8 font-mono text-[12px]"
                />
                {searchPending && (
                  <Spinner className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                )}
              </div>

              <div className="max-h-72 overflow-y-auto rounded-lg ring-1 ring-foreground/6">
                {searchResults.length > 0
? (
                  <ul className="divide-y divide-foreground/4">
                    {searchResults.map(result => (
                      <li key={result.id}>
                        <button
                          type="button"
                          onClick={() => void saveRegistryMapping(mappingModel, result)}
                          disabled={savingMapping}
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
                          {result.capabilities.contextWindow != null
                            && result.capabilities.contextWindow > 0 && (
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {Math.round(result.capabilities.contextWindow / 1000)}
k
                              </span>
                            )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )
: (
                  <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">
                    {searchPending
                      ? t('models.mapping.searching')
                      : t('models.mapping.emptyResults')}
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter variant="bare">
            <Button size="sm" variant="outline" onClick={closeMappingDialog}>
              {t('models.action.cancel')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="gap-1.5"
              onClick={() => {
                setManualDraft(createManualDraft(mappingModel, searchQuery))
                setManualOpen(true)
              }}
            >
              <SlidersHorizontalIcon className="size-3.5" />
              {t('models.mapping.createEntry')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={manualOpen} onOpenChange={open => !open && setManualOpen(false)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('models.manual.title')}</DialogTitle>
            <DialogDescription>
              {t('models.manual.description')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid max-h-[min(70vh,34rem)] grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
            <Input
              value={manualDraft.id}
              onChange={event => setManualDraft({ ...manualDraft, id: event.target.value })}
              placeholder={t('models.manual.field.id')}
              className="h-8 font-mono text-[12px]"
            />
            <Input
              value={manualDraft.name}
              onChange={event => setManualDraft({ ...manualDraft, name: event.target.value })}
              placeholder={t('models.manual.field.name')}
              className="h-8 text-[12px]"
            />
            <Input
              value={manualDraft.context}
              onChange={event => setManualDraft({ ...manualDraft, context: event.target.value })}
              placeholder={t('models.manual.field.contextWindow')}
              className="h-8 font-mono text-[12px]"
            />
            <Input
              value={manualDraft.output}
              onChange={event => setManualDraft({ ...manualDraft, output: event.target.value })}
              placeholder={t('models.manual.field.maxOutputTokens')}
              className="h-8 font-mono text-[12px]"
            />
            <Input
              value={manualDraft.family}
              onChange={event => setManualDraft({ ...manualDraft, family: event.target.value })}
              placeholder={t('models.manual.field.family')}
              className="h-8 font-mono text-[12px]"
            />
            <Input
              value={manualDraft.knowledge}
              onChange={event =>
                setManualDraft({ ...manualDraft, knowledge: event.target.value })}
              placeholder={t('models.manual.field.knowledgeCutoff')}
              className="h-8 font-mono text-[12px]"
            />
            <Input
              value={manualDraft.releaseDate}
              onChange={event =>
                setManualDraft({ ...manualDraft, releaseDate: event.target.value })}
              placeholder={t('models.manual.field.releaseDate')}
              className="h-8 font-mono text-[12px]"
            />
            <Input
              value={manualDraft.costInput}
              onChange={event =>
                setManualDraft({ ...manualDraft, costInput: event.target.value })}
              placeholder={t('models.manual.field.inputCost')}
              className="h-8 font-mono text-[12px]"
            />
            <Input
              value={manualDraft.costOutput}
              onChange={event =>
                setManualDraft({ ...manualDraft, costOutput: event.target.value })}
              placeholder={t('models.manual.field.outputCost')}
              className="h-8 font-mono text-[12px]"
            />
            <Input
              value={manualDraft.costCacheRead}
              onChange={event =>
                setManualDraft({ ...manualDraft, costCacheRead: event.target.value })}
              placeholder={t('models.manual.field.cacheReadCost')}
              className="h-8 font-mono text-[12px]"
            />
            <Input
              value={manualDraft.costCacheWrite}
              onChange={event =>
                setManualDraft({ ...manualDraft, costCacheWrite: event.target.value })}
              placeholder={t('models.manual.field.cacheWriteCost')}
              className="h-8 font-mono text-[12px]"
            />

            <div className="grid gap-2 rounded-lg bg-muted/35 p-3 sm:col-span-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
                  <Checkbox
                    checked={manualDraft.inputText}
                    onCheckedChange={checked =>
                      setManualDraft({ ...manualDraft, inputText: !!checked })}
                  />
                  {t('models.manual.capability.textInput')}
                </label>
                <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
                  <Checkbox
                    checked={manualDraft.inputImage}
                    onCheckedChange={checked =>
                      setManualDraft({ ...manualDraft, inputImage: !!checked })}
                  />
                  {t('models.manual.capability.imageInput')}
                </label>
                <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
                  <Checkbox
                    checked={manualDraft.outputText}
                    onCheckedChange={checked =>
                      setManualDraft({ ...manualDraft, outputText: !!checked })}
                  />
                  {t('models.manual.capability.textOutput')}
                </label>
                <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
                  <Checkbox
                    checked={manualDraft.reasoning}
                    onCheckedChange={checked =>
                      setManualDraft({ ...manualDraft, reasoning: !!checked })}
                  />
                  {t('models.manual.capability.reasoning')}
                </label>
                <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
                  <Checkbox
                    checked={manualDraft.toolCall}
                    onCheckedChange={checked =>
                      setManualDraft({ ...manualDraft, toolCall: !!checked })}
                  />
                  {t('models.manual.capability.tools')}
                </label>
                <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
                  <Checkbox
                    checked={manualDraft.temperature}
                    onCheckedChange={checked =>
                      setManualDraft({ ...manualDraft, temperature: !!checked })}
                  />
                  {t('models.manual.capability.temperature')}
                </label>
                <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
                  <Checkbox
                    checked={manualDraft.structuredOutput}
                    onCheckedChange={checked =>
                      setManualDraft({ ...manualDraft, structuredOutput: !!checked })}
                  />
                  {t('models.manual.capability.structuredOutput')}
                </label>
              </div>
            </div>
          </div>

          <DialogFooter variant="bare">
            <Button size="sm" variant="outline" onClick={() => setManualOpen(false)}>
              {t('models.action.back')}
            </Button>
            <Button
              size="sm"
              onClick={saveManualMapping}
              disabled={!manualDraft.id.trim() || savingMapping}
              className="gap-1.5"
            >
              {savingMapping && <Spinner className="size-3.5" />}
              {t('models.manual.saveMapping')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Footer summary */}
      <div className="flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>
          {allDisabled
            ? t('models.summary.allHidden')
            : visibility.kind === 'all'
              ? t('models.summary.allVisible', { modelCount: models.length })
              : t('models.summary.someVisible', { enabledCount, totalCount: models.length })}
        </span>
        {cachedAt && models.length > 0 && (
          (() => {
            const timeAgo = formatTimeAgo(cachedAt)
            return (
              <span className="text-[10.5px] text-muted-foreground/60">
                {t('models.summary.cached', {
                  timeAgo: renderTimeAgo(timeAgo, t),
                })}
              </span>
            )
          })()
        )}
      </div>
    </div>
  )
}
