/* Header for the Nowledge panel — branding + status pill + space picker +
   global refresh. Mirrors the visual language of the agent-management
   header rows: tight 13px label, 12px description, mingcute line icons. */

import type { WebPluginContext } from '@cradle/plugin-sdk/web'
import {
  BrainLine as BrainIcon,
  Refresh1Line as RefreshIcon,
} from '@mingcute/react'
import { useCallback, useEffect, useState } from 'react'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Separator } from '~/components/ui/separator'
import { Spinner } from '~/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'

import { fetchStatus } from './hooks'

interface PanelHeaderProps {
  ctx: WebPluginContext
  isActive: boolean
}

interface HeaderStatus {
  healthy: boolean
  disabled: boolean
  hasApiKey: boolean
  statusText: string
}

export function PanelHeader({ ctx, isActive }: PanelHeaderProps) {
  const [status, setStatus] = useState<HeaderStatus | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [spaceId, setSpaceId] = useState<string | null>(null)

  const refreshStatus = useCallback(async () => {
    setRefreshing(true)
    try {
      const next = await fetchStatus(ctx.routes)
      const health = next.health as { skipped?: boolean, status?: string } | null
      const skipped = health?.skipped === true
      setStatus({
        healthy: !skipped && (health?.status === 'ok' || health?.status === 'healthy' || !health?.status),
        disabled: skipped,
        hasApiKey: next.config.hasApiKey,
        statusText: skipped
          ? 'Disabled'
          : health?.status === 'ok' || health?.status === 'healthy' || !health?.status
            ? 'Connected'
            : (health?.status ?? 'Unknown'),
      })
      setSpaceId(prev => prev ?? next.config.spaceId ?? '')
    }
    catch {
      setStatus({
        healthy: false,
        disabled: false,
        hasApiKey: false,
        statusText: 'Offline',
      })
    }
    finally {
      setRefreshing(false)
    }
  }, [ctx.routes])

  useEffect(() => {
    if (!isActive) { return }
    void refreshStatus()
    const id = setInterval(() => void refreshStatus(), 30_000)
    return () => clearInterval(id)
  }, [isActive, refreshStatus])

  const onSpaceChange = useCallback((value: string) => {
    const trimmed = value.trim()
    setSpaceId(trimmed)
    // Persist as a default space override in local UI state (not into /config
    // — that requires explicit Save in the Config tab).
    try {
      ctx.storage.set('ui.activeSpaceId', trimmed)
    }
    catch {
      /* best-effort */
    }
    // Dispatch a storage event so tabs pick up the change.
    window.dispatchEvent(new CustomEvent('nowledge-space-change', { detail: trimmed }))
  }, [ctx.storage])

  useEffect(() => {
    try {
      const stored = ctx.storage.get('ui.activeSpaceId')
      if (stored != null) { setSpaceId(stored) }
    }
    catch {
      /* ignore */
    }
  }, [ctx.storage])

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <BrainIcon className="size-4" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium font-heading text-foreground">Nowledge Mem</span>
            {status && (
              <span
                className={cn(
                  'flex items-center gap-1 text-[11px] font-medium',
                  status.healthy ? 'text-success' : status.disabled ? 'text-muted-foreground' : 'text-destructive',
                )}
                title={status.statusText}
              >
                {/* <PulseIcon className={cn('size-3', status.healthy && 'animate-pulse')} aria-hidden="true" /> */}
                {status.statusText}
              </span>
            )}
          </div>
          <span className="truncate text-[11.5px] text-muted-foreground">
            Persistent memory, Working Memory, and threads
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {status && !status.hasApiKey && (
          <Badge variant="outline" className="text-warning">No API key</Badge>
        )}

        <SpacePicker value={spaceId ?? ''} onChange={onSpaceChange} />

        <Tooltip>
          <TooltipTrigger
            render={(
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={() => void refreshStatus()}
                disabled={refreshing}
                aria-label="Refresh status"
              >
                {refreshing ? <Spinner className="size-3.5" /> : <RefreshIcon className="size-3.5" aria-hidden="true" />}
              </Button>
            )}
          />
          <TooltipContent side="bottom">Refresh status</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}

function SpacePicker({ value, onChange }: { value: string, onChange: (next: string) => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={(
            <PopoverTrigger
              render={(
                <Button type="button" size="sm" variant="outline" className="gap-1.5 px-2">
                  <span className="text-[11px] text-muted-foreground">Space</span>
                  <span className="max-w-[120px] truncate font-mono text-[11.5px]">{value || 'default'}</span>
                </Button>
              )}
            />
          )}
        />
        <TooltipContent side="bottom">Switch active space (session only)</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-64 p-3">
        <div className="flex flex-col gap-2">
          <label className="text-[12px] font-medium text-foreground">Active space</label>
          <Input
            value={draft}
            placeholder="default"
            autoComplete="off"
            spellCheck={false}
            onChange={e => setDraft(e.target.value)}
            className="h-8 font-mono text-[12px]"
          />
          <p className="text-[11px] text-muted-foreground">
            Override for this session. Save in Config to persist as default.
          </p>
          <Separator />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setDraft(value); setOpen(false) }}>Cancel</Button>
            <Button size="sm" onClick={() => { onChange(draft); setOpen(false) }}>Apply</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
