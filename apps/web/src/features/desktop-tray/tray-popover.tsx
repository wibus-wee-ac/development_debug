import { useQuery } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import {
  ActivityIcon,
  BotMessageSquareIcon,
  BarChart3Icon,
  BotIcon,
  CalendarClockIcon,
  CheckSquareIcon,
  CircleDotIcon,
  Clock3Icon,
  CommandIcon,
  FolderIcon,
  MessageCircleIcon,
  MessageSquarePlusIcon,
  PanelTopOpenIcon,
  PowerIcon,
  PuzzleIcon,
  RefreshCwIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
} from 'lucide-react'
import { useCallback, useEffect } from 'react'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'
import { useThemeStore } from '~/store/theme'

import { readTraySnapshot } from './api'
import type { TrayActionId, TrayMetric, TrayQuickAction, TraySessionItem, TraySnapshot } from './types'

const SESSION_ICON_CLASS = 'size-3.5'

const ACTION_ICONS: Record<TrayActionId, LucideIcon> = {
  'open-app': PanelTopOpenIcon,
  'open-chat': MessageCircleIcon,
  'new-chat': MessageSquarePlusIcon,
  'global-search': SearchIcon,
  'open-resident': Clock3Icon,
  'open-running': BotIcon,
  'open-approvals': CheckSquareIcon,
  'open-awaits': CircleDotIcon,
  'open-automation': CalendarClockIcon,
  'open-workspaces': FolderIcon,
  'open-agents': BotMessageSquareIcon,
  'open-providers': SettingsIcon,
  'open-chronicle': ActivityIcon,
  'open-usage': BarChart3Icon,
  'open-plugins': PuzzleIcon,
  'open-desktop-settings': SettingsIcon,
  'quit': PowerIcon,
}

const METRIC_TONE_CLASS: Record<TrayMetric['tone'], string> = {
  neutral: 'bg-muted/40 text-muted-foreground',
  active: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  danger: 'bg-destructive/10 text-destructive',
}

function useTrayTheme(): void {
  const mode = useThemeStore(s => s.mode)

  useEffect(() => {
    const applyDark = (dark: boolean): void => {
      document.documentElement.classList.toggle('dark', dark)
    }

    if (mode !== 'system') {
      applyDark(mode === 'dark')
      return
    }

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    applyDark(mq.matches)
    const listener = (event: MediaQueryListEvent): void => applyDark(event.matches)
    mq.addEventListener('change', listener)
    return () => mq.removeEventListener('change', listener)
  }, [mode])
}

function buildListActionPayload(actionId: TrayActionId, snapshot: TraySnapshot): { sessionId: string } | undefined {
  if (actionId === 'open-running') {
    const firstRunning = snapshot.running[0]
    return firstRunning ? { sessionId: firstRunning.sessionId } : undefined
  }

  if (actionId === 'open-resident') {
    const firstResident = snapshot.resident[0]
    return firstResident ? { sessionId: firstResident.sessionId } : undefined
  }

  return undefined
}

function SectionTitle({ label, count }: { label: string, count: number }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">{count}</span>
      <div className="h-px flex-1 bg-border/50" />
    </div>
  )
}

function EmptySection({ label }: { label: string }) {
  return (
    <div className="rounded-lg bg-muted/30 px-3 py-3 text-center text-[11px] text-muted-foreground">
      {label}
    </div>
  )
}

function SessionRow({
  item,
  active,
  onOpen,
}: {
  item: TraySessionItem
  active?: boolean
  onOpen: (item: TraySessionItem) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className={cn(
        'group flex min-h-12 w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-[background-color,transform]',
        'hover:bg-accent active:scale-[0.96]',
      )}
    >
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md',
          active ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300' : 'bg-muted text-muted-foreground',
        )}
      >
        {active ? <BotIcon className={SESSION_ICON_CLASS} /> : <MessageCircleIcon className={SESSION_ICON_CLASS} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium leading-4 text-foreground">{item.title}</span>
        <span className="block truncate text-[11px] leading-4 text-muted-foreground">{item.workspaceName}</span>
      </span>
      <span className="max-w-20 shrink-0 truncate text-right text-[10px] text-muted-foreground">{item.modelId ?? item.runtimeKind}</span>
    </button>
  )
}

function MetricPill({ metric }: { metric: TrayMetric }) {
  return (
    <div className={cn('min-w-0 rounded-lg px-2 py-1.5', METRIC_TONE_CLASS[metric.tone])}>
      <div className="truncate text-[10px] leading-3 opacity-80">{metric.label}</div>
      <div className="truncate text-xs font-semibold tabular-nums leading-4">{metric.value}</div>
    </div>
  )
}

function QuickActionButton({
  action,
  onAction,
}: {
  action: TrayQuickAction
  onAction: (action: TrayQuickAction) => void
}) {
  const Icon = ACTION_ICONS[action.id] ?? CommandIcon

  return (
    <button
      type="button"
      disabled={!action.enabled}
      onClick={() => onAction(action)}
      className={cn(
        'group flex min-h-14 items-start gap-2 rounded-lg bg-muted/30 px-2.5 py-2 text-left',
        'transition-[background-color,transform,opacity] hover:bg-accent active:scale-[0.96]',
        'disabled:pointer-events-none disabled:opacity-45',
      )}
    >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground shadow-[0_1px_0_rgba(0,0,0,0.04)]">
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-medium leading-4 text-foreground">{action.label}</span>
          {action.badge ? <Badge variant="secondary" className="h-4 px-1.5 text-[10px] tabular-nums">{action.badge}</Badge> : null}
        </span>
        <span className="mt-0.5 line-clamp-2 text-[10px] leading-3.5 text-muted-foreground">{action.description}</span>
      </span>
      {action.accelerator ? <span className="text-[10px] text-muted-foreground">{action.accelerator}</span> : null}
    </button>
  )
}

export function TrayPopover() {
  useTrayTheme()

  const trayQuery = useQuery({
    queryKey: ['desktop-tray', 'snapshot'],
    queryFn: readTraySnapshot,
    refetchInterval: 4_000,
    staleTime: 1_000,
  })

  const snapshot = trayQuery.data

  const performAction = useCallback((actionId: TrayActionId, payload?: unknown) => {
    void window.cradle?.desktopTray?.performAction(actionId, payload)
  }, [])

  const openSession = useCallback((item: TraySessionItem) => {
    performAction('open-chat', { sessionId: item.sessionId })
  }, [performAction])

  const performQuickAction = useCallback((action: TrayQuickAction) => {
    if (!snapshot) {
      return
    }
    performAction(action.id, buildListActionPayload(action.id, snapshot))
  }, [performAction, snapshot])

  const primaryActions = snapshot?.quickActions.filter(action => action.id === 'open-app' || action.id === 'new-chat') ?? []
  const secondaryActions = snapshot?.quickActions.filter(action => action.id !== 'open-app' && action.id !== 'new-chat') ?? []

  return (
    <main className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground antialiased">
      <div className="flex shrink-0 items-center justify-between px-3.5 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <SparklesIcon className="size-4" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold leading-5">Cradle</h1>
            <p className="truncate text-[11px] leading-4 text-muted-foreground">
              {trayQuery.isFetching ? 'Refreshing' : 'Desktop'}
            </p>
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => void trayQuery.refetch()} aria-label="Refresh tray">
          <RefreshCwIcon className={cn('size-3.5', trayQuery.isFetching && 'animate-spin')} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
        {trayQuery.isError ? (
          <div className="m-1 rounded-lg bg-destructive/10 px-3 py-3 text-xs text-destructive">
            Tray data is unavailable.
          </div>
        ) : null}

        <div className="grid grid-cols-3 gap-1.5 px-1 pb-3">
          {(snapshot?.metrics ?? []).slice(0, 6).map(metric => (
            <MetricPill key={metric.id} metric={metric} />
          ))}
        </div>

        <div className="space-y-3">
          <section className="space-y-1.5">
            <SectionTitle label="Running" count={snapshot?.running.length ?? 0} />
            {snapshot && snapshot.running.length > 0
              ? snapshot.running.map(item => <SessionRow key={item.id} item={item} active onOpen={openSession} />)
              : <EmptySection label="No active agent runs" />}
          </section>

          <section className="space-y-1.5">
            <SectionTitle label="Resident" count={snapshot?.resident.length ?? 0} />
            {snapshot && snapshot.resident.length > 0
              ? snapshot.resident.map(item => <SessionRow key={item.id} item={item} onOpen={openSession} />)
              : <EmptySection label="No resident chats" />}
          </section>

          <section className="space-y-1.5">
            <SectionTitle label="Actions" count={secondaryActions.length} />
            <div className="grid grid-cols-2 gap-1.5">
              {secondaryActions.map(action => (
                <QuickActionButton key={action.id} action={action} onAction={performQuickAction} />
              ))}
            </div>
          </section>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-[1fr_1fr_auto] gap-1.5 border-t border-border/60 bg-background/95 px-2.5 py-2.5">
        {primaryActions.map(action => (
          <Button
            key={action.id}
            type="button"
            variant={action.id === 'new-chat' ? 'default' : 'outline'}
            size="sm"
            disabled={!action.enabled}
            onClick={() => performQuickAction(action)}
            className="h-8 rounded-lg text-xs"
          >
            {action.id === 'new-chat' ? <MessageSquarePlusIcon className="size-3.5" /> : <PanelTopOpenIcon className="size-3.5" />}
            {action.label}
          </Button>
        ))}
        <Button type="button" variant="destructive" size="icon-sm" onClick={() => performAction('quit')} aria-label="Quit Cradle">
          <PowerIcon className="size-3.5" />
        </Button>
      </div>
    </main>
  )
}
