import { RefreshCwIcon, SearchIcon } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { modelIsVisible, readModelVisibility } from '~/features/agent-runtime/model-visibility'
import { cn } from '~/lib/cn'
import type { ModelDescriptor } from '~/lib/types'

import { ALL_DISABLED_SENTINEL } from './agent-runtime-settings'

function formatTimeAgo(ts: number): string {
  const seconds = Math.round((Date.now() - ts) / 1000)
  if (seconds < 60) {
    return 'just now'
  }
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.round(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

export function ModelsPanel({
  loading,
  models,
  enabledModels,
  onChange,
  onRefresh,
  cachedAt,
}: {
  loading: boolean
  models: ModelDescriptor[]
  enabledModels: string[]
  onChange: (next: string[]) => void
  onRefresh?: () => void
  cachedAt?: number | null
}) {
  const [filter, setFilter] = useState('')

  const visibility = useMemo(() => readModelVisibility(enabledModels), [enabledModels])
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

  const enabledCount = visibility.kind === 'none'
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

  return (
    <div className="flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[12.5px] font-medium text-foreground">Available models</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Choose which models appear in the chat model picker for this provider.
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
              Refresh
            </Button>
          )}
          {(isExplicitSelection || allDisabled) && (
            <Button
              size="xs"
              variant="ghost"
              className="text-[11px] text-muted-foreground"
              onClick={() => onChange([])}
            >
              Show all
            </Button>
          )}
          {!allDisabled && (
            <Button
              size="xs"
              variant="ghost"
              className="text-[11px] text-muted-foreground"
              onClick={() => onChange([ALL_DISABLED_SENTINEL])}
            >
              Disable all
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
          placeholder="Filter models…"
          className="h-8 pl-8 text-[12.5px]"
        />
      </div>

      {/* Body */}
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/6">
        {loading
          ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-muted-foreground">
              <Spinner className="size-3" />
              Fetching models…
            </div>
          )
          : models.length === 0
            ? (
              <div className="px-4 py-8 text-center">
                <p className="text-[12px] text-muted-foreground">
                  No models returned by this provider.
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground/70">
                  Save your endpoint and API key first; they may be required to list models.
                </p>
                {onRefresh && (
                  <Button
                    size="xs"
                    variant="outline"
                    className="mt-3 gap-1.5 text-[11px]"
                    onClick={onRefresh}
                  >
                    <RefreshCwIcon className="size-3" />
                    Fetch Models
                  </Button>
                )}
              </div>
            )
            : (
              <div className="max-h-72 overflow-y-auto">
                <ul className="divide-y divide-foreground/4">
                  {visible.map((m) => {
                    const checked = isChecked(m.id)
                    return (
                      <li key={m.id}>
                        <label
                          className={cn(
                            'flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors',
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
                          </div>
                          {m.capabilities.contextWindow != null && m.capabilities.contextWindow > 0 && (
                            <Badge variant="secondary" className="font-mono text-[10px] font-normal tabular-nums text-muted-foreground">
                              {Math.round(m.capabilities.contextWindow / 1000)}
                              k
                            </Badge>
                          )}
                        </label>
                      </li>
                    )
                  })}
                  {visible.length === 0 && (
                    <li className="px-4 py-8 text-center text-[11.5px] text-muted-foreground">
                      No models match
                      {' '}
                      <span className="font-mono text-foreground">{filter}</span>
                      .
                    </li>
                  )}
                </ul>
              </div>
            )}
      </div>

      {/* Footer summary */}
      <div className="flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>
          {allDisabled
            ? 'All models hidden from chat'
            : visibility.kind === 'all'
              ? `All ${models.length || ''} models visible`.trim()
              : `${enabledCount} of ${models.length} model${models.length === 1 ? '' : 's'} visible`}
        </span>
        {cachedAt && models.length > 0 && (
          <span className="text-[10.5px] text-muted-foreground/60">
            cached
{' '}
{formatTimeAgo(cachedAt)}
          </span>
        )}
      </div>
    </div>
  )
}
