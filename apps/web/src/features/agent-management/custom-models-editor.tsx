import { PlusIcon, SparklesIcon, Trash2Icon } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'
import { getServerUrl } from '~/lib/electron'

interface CustomModelEntry {
  id: string
  label: string
  contextWindow: number | null
}

export function CustomModelsEditor({
  profileId,
  models,
  onChange,
}: {
  profileId: string
  models: CustomModelEntry[]
  onChange: (next: CustomModelEntry[]) => void
}) {
  const [newId, setNewId] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const addModel = useCallback(async () => {
    const id = newId.trim()
    if (!id || models.some(m => m.id === id)) {
      return
    }

    setLookupLoading(true)
    try {
      const res = await fetch(`${getServerUrl()}/providers/model-lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: id }),
      })
      const data = res.ok ? await res.json() as { id: string, label: string, contextWindow: number | null } | null : null

      const entry: CustomModelEntry = data
        ? { id: data.id, label: data.label, contextWindow: data.contextWindow }
        : { id, label: id, contextWindow: null }

      const next = [...models, entry]
      onChange(next)
      setNewId('')
      inputRef.current?.focus()
    }
    catch {
      // If lookup fails, add with just the ID
      const next = [...models, { id, label: id, contextWindow: null }]
      onChange(next)
      setNewId('')
    }
    finally {
      setLookupLoading(false)
    }
  }, [newId, models, onChange])

  const removeModel = useCallback((id: string) => {
    onChange(models.filter(m => m.id !== id))
  }, [models, onChange])

  const enrichModel = useCallback(async (modelId: string) => {
    setLookupLoading(true)
    try {
      const res = await fetch(`${getServerUrl()}/providers/model-lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId }),
      })
      const data = res.ok ? await res.json() as { id: string, label: string, contextWindow: number | null } | null : null
      if (data) {
        onChange(models.map(m => m.id === modelId ? { ...m, label: data.label, contextWindow: data.contextWindow } : m))
      }
    }
    catch { /* ignore */ }
    finally {
      setLookupLoading(false)
    }
  }, [models, onChange])

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
          disabled={!newId.trim() || lookupLoading}
          className="gap-1"
        >
          {lookupLoading ? <Spinner className="size-3" /> : <PlusIcon className="size-3" />}
          Add
        </Button>
      </div>

      {/* List */}
      {models.length > 0 && (
        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/6">
          <ul className="divide-y divide-foreground/4">
            {models.map(m => (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2">
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
                {m.contextWindow != null && m.contextWindow > 0 && (
                  <Badge variant="secondary" className="font-mono text-[10px] font-normal tabular-nums text-muted-foreground">
                    {Math.round(m.contextWindow / 1000)}k
                  </Badge>
                )}
                {m.label === m.id && (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => void enrichModel(m.id)}
                    className={cn('text-muted-foreground/50 hover:text-foreground', lookupLoading && 'pointer-events-none')}
                    title="Auto-match from models.dev"
                  >
                    <SparklesIcon className="size-3" />
                  </Button>
                )}
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => removeModel(m.id)}
                  className="text-muted-foreground/50 hover:text-destructive"
                >
                  <Trash2Icon className="size-3" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
