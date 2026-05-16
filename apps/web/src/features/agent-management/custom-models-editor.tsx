import { useMutation } from '@tanstack/react-query'
import { PlusIcon, SparklesIcon, Trash2Icon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { postProvidersModelLookup, postProvidersModelSearch } from '~/api-gen/sdk.gen'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'
import type { ModelCapabilities } from '~/lib/types'

interface CustomModelEntry {
  id: string
  label: string
  capabilities: ModelCapabilities
}

interface SearchResult {
  id: string
  label: string
  capabilities: ModelCapabilities
}

export function CustomModelsEditor({
  models,
  onChange,
}: {
  profileId: string
  models: CustomModelEntry[]
  onChange: (next: CustomModelEntry[]) => void
}) {
  const [newId, setNewId] = useState('')
  const [enrichingId, setEnrichingId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [highlightIdx, setHighlightIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchListRef = useRef<HTMLUListElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const lookupMutation = useMutation({
    mutationFn: async (modelId: string) => {
      const { data } = await postProvidersModelLookup({
        body: { modelId },
        throwOnError: true,
      })
      return data as { id: string, label: string, capabilities: ModelCapabilities } | null
    },
  })

  const searchMutation = useMutation({
    mutationFn: async (query: string) => {
      const { data } = await postProvidersModelSearch({
        body: { query },
        throwOnError: true,
      })
      return (data ?? []) as SearchResult[]
    },
  })

  // Debounced search trigger
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(() => {
      searchMutation.mutate(searchQuery.trim(), {
        onSuccess: (data) => {
          setSearchResults(data)
          setHighlightIdx(0)
        },
      })
    }, 250)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery])

  const addModel = useCallback(async () => {
    const id = newId.trim()
    if (!id || models.some(m => m.id === id)) {
      return
    }

    try {
      const result = await lookupMutation.mutateAsync(id)
      const entry: CustomModelEntry = result
        ? { id: result.id, label: result.label, capabilities: result.capabilities ?? {} }
        : { id, label: id, capabilities: {} }
      onChange([...models, entry])
    }
    catch {
      onChange([...models, { id, label: id, capabilities: {} }])
    }
    setNewId('')
    inputRef.current?.focus()
  }, [newId, models, onChange, lookupMutation])

  const removeModel = useCallback((id: string) => {
    onChange(models.filter(m => m.id !== id))
  }, [models, onChange])

  const applyEnrichResult = useCallback((targetModelId: string, result: SearchResult) => {
    onChange(models.map(m => m.id === targetModelId ? { ...m, label: result.label, capabilities: result.capabilities } : m))
    setEnrichingId(null)
    setSearchQuery('')
    setSearchResults([])
  }, [models, onChange])

  const startEnrich = useCallback((modelId: string) => {
    setEnrichingId(modelId)
    setSearchQuery(modelId)
    setHighlightIdx(0)
    setTimeout(() => searchInputRef.current?.focus(), 0)
  }, [])

  const cancelEnrich = useCallback(() => {
    setEnrichingId(null)
    setSearchQuery('')
    setSearchResults([])
  }, [])

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      cancelEnrich()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIdx((i) => {
        const next = Math.min(i + 1, searchResults.length - 1)
        searchListRef.current?.children[next]?.scrollIntoView({ block: 'nearest' })
        return next
      })
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIdx((i) => {
        const next = Math.max(i - 1, 0)
        searchListRef.current?.children[next]?.scrollIntoView({ block: 'nearest' })
        return next
      })
      return
    }
    if (e.key === 'Enter' && enrichingId && searchResults.length > 0) {
      e.preventDefault()
      applyEnrichResult(enrichingId, searchResults[highlightIdx])
    }
  }, [cancelEnrich, enrichingId, searchResults, highlightIdx, applyEnrichResult])

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-[12.5px] font-medium text-foreground">Custom models</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Add model IDs manually when the /models endpoint is unavailable or incomplete.
        </p>
      </div>

      {/* Add input */}
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          value={newId}
          onChange={e => setNewId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && void addModel()}
          placeholder="e.g. claude-sonnet-4-20250514"
          className="h-8 flex-1 font-mono text-[12px]"
        />
        <Button
          size="xs"
          variant="secondary"
          onClick={() => void addModel()}
          disabled={!newId.trim() || lookupMutation.isPending}
          className="gap-1"
        >
          {lookupMutation.isPending ? <Spinner className="size-3" /> : <PlusIcon className="size-3" />}
          Add
        </Button>
      </div>

      {/* List */}
      {models.length > 0 && (
        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/6">
          <ul className="divide-y divide-foreground/4">
            {models.map(m => (
              <li key={m.id} className="relative">
                <div className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium text-foreground">
                      {m.label !== m.id ? m.label : m.id}
                    </div>
                    {m.label !== m.id && (
                      <div className="truncate font-mono text-[10.5px] text-muted-foreground/70">
                        {m.id}
                      </div>
                    )}
                  </div>
                  {m.capabilities.contextWindow != null && m.capabilities.contextWindow > 0 && (
                    <Badge variant="secondary" className="font-mono text-[10px] font-normal tabular-nums text-muted-foreground">
                      {Math.round(m.capabilities.contextWindow / 1000)}
                      k
                    </Badge>
                  )}
                  {m.capabilities.reasoning && (
                    <Badge variant="secondary" className="text-[10px] font-normal text-muted-foreground">
                      reasoning
                    </Badge>
                  )}
                  {m.capabilities.inputModalities && m.capabilities.inputModalities.length > 1 && (
                    <Badge variant="secondary" className="text-[10px] font-normal text-muted-foreground">
                      multimodal
                    </Badge>
                  )}
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => startEnrich(m.id)}
                    className="text-muted-foreground/50 hover:text-foreground"
                    title="Match from models.dev"
                  >
                    <SparklesIcon className="size-3" />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => removeModel(m.id)}
                    className="text-muted-foreground/50 hover:text-destructive"
                  >
                    <Trash2Icon className="size-3" />
                  </Button>
                </div>

                {/* Inline search autocomplete */}
                {enrichingId === m.id && (
                  <div className="border-t border-foreground/4 bg-muted/30 px-3 py-2">
                    <div className="relative">
                      <Input
                        ref={searchInputRef}
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        onKeyDown={handleSearchKeyDown}
                        placeholder="Search models.dev..."
                        className="h-7 font-mono text-[11px]"
                        autoFocus
                      />
                      {searchMutation.isPending && (
                        <Spinner className="absolute right-2 top-1/2 size-3 -translate-y-1/2" />
                      )}
                    </div>
                    {searchResults.length > 0 && (
                      <ul ref={searchListRef} className="mt-1.5 max-h-40 overflow-y-auto rounded-lg ring-1 ring-foreground/6">
                        {searchResults.map((r, idx) => (
                          <li key={r.id}>
                            <button
                              type="button"
                              onClick={() => applyEnrichResult(m.id, r)}
                              onMouseEnter={() => setHighlightIdx(idx)}
                              className={cn(
                                'flex w-full items-center gap-2 px-2.5 py-1.5 text-left',
                                idx === highlightIdx && 'bg-accent',
                              )}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[11px] font-medium text-foreground">
                                  {r.label}
                                </div>
                                <div className="truncate font-mono text-[10px] text-muted-foreground/70">
                                  {r.id}
                                </div>
                              </div>
                              {r.capabilities.contextWindow != null && r.capabilities.contextWindow > 0 && (
                                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                                  {Math.round(r.capabilities.contextWindow / 1000)}
                                  k
                                </span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {searchQuery.trim() && !searchMutation.isPending && searchResults.length === 0 && (
                      <p className="mt-1.5 text-[10.5px] text-muted-foreground">No matches found</p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
