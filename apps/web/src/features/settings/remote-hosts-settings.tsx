// Remote runtime hosts settings — a guided, To-C take on the feature.
//
// This is a private-preview capability: Cradle runs a small agent daemon
// (`cradle-agentd`) on a remote machine and reaches it over SSH. The UI
// intentionally hides transport internals (local forwarded socket paths,
// daemon host ids, arch) and shows users only what they need:
//   - A friendly name and the SSH target they already use
//   - A 3-step setup guide the first time they arrive (and on demand after)
//   - Connect / disconnect, and a clean view of what the remote host offers
//     (runtimes, workspaces, live agents) once connected
//
// Socket paths are daemon deployment details. The remote socket path stays in
// an "Advanced" disclosure for non-default setups; the local forwarded socket
// path is a server-side concern and is never exposed here.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownLine as ChevronIcon,
  CheckLine as CheckIcon,
  CopyLine as CopyIcon,
  DeleteLine as TrashIcon,
  PencilLine as PencilIcon,
  PlusLine as PlusIcon,
  Refresh2Line as RefreshIcon,
  ServerLine as ServerIcon,
} from '@mingcute/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getRemoteRuntimeHostsByHostIdAgentsOptions,
  getRemoteRuntimeHostsByHostIdAgentsQueryKey,
  getRemoteRuntimeHostsByHostIdHealthOptions,
  getRemoteRuntimeHostsByHostIdHealthQueryKey,
  getRemoteRuntimeHostsByHostIdRuntimesOptions,
  getRemoteRuntimeHostsByHostIdRuntimesQueryKey,
  getRemoteRuntimeHostsByHostIdWorkspacesOptions,
  getRemoteRuntimeHostsByHostIdWorkspacesQueryKey,
  getRemoteRuntimeHostsOptions,
  getRemoteRuntimeHostsQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import {
  deleteRemoteRuntimeHostsByHostId,
  patchRemoteRuntimeHostsByHostId,
  postRemoteRuntimeHosts,
  postRemoteRuntimeHostsByHostIdConnect,
  postRemoteRuntimeHostsByHostIdDisconnect,
  postWorkspaces,
} from '~/api-gen/sdk.gen'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '~/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { toastManager } from '~/components/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'

import { SettingsGroup, SettingsPage } from './settings-container'

import type { GetRemoteRuntimeHostsResponse } from '~/api-gen/types.gen'

type Host = GetRemoteRuntimeHostsResponse[number]
type ConnectionState = Host['connectionState']

type SettingsKey = keyof typeof import('~/locales/default').default.settings

const DEFAULT_REMOTE_SOCKET_PATH = '~/.cradle/agentd/agent.sock'

/** The daemon client throws the parsed error body (a plain object), not an Error. */
function describeError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.length > 0) {
      return message
    }
  }
  if (typeof error === 'string') {
    return error
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

interface ConnectionDotSpec {
  tone: 'success' | 'warn' | 'muted' | 'danger'
  pulse: boolean
  labelKey: SettingsKey
}

function connectionDotSpec(state: ConnectionState): ConnectionDotSpec {
  switch (state) {
    case 'connected':
      return { tone: 'success', pulse: false, labelKey: 'remoteHosts.state.connected' }
    case 'connecting':
      return { tone: 'warn', pulse: true, labelKey: 'remoteHosts.state.connecting' }
    case 'offline':
      return { tone: 'danger', pulse: false, labelKey: 'remoteHosts.state.offline' }
    case 'disconnected':
      return { tone: 'warn', pulse: false, labelKey: 'remoteHosts.state.disconnected' }
    case 'idle':
    default:
      return { tone: 'muted', pulse: false, labelKey: 'remoteHosts.state.idle' }
  }
}

const DOT_BG: Record<ConnectionDotSpec['tone'], string> = {
  success: 'bg-emerald-500',
  warn: 'bg-amber-500',
  muted: 'bg-muted-foreground/40',
  danger: 'bg-destructive',
}

function ConnectionDot({ state }: { state: ConnectionState }) {
  const { t } = useTranslation('settings')
  const spec = connectionDotSpec(state)
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="relative flex size-2 shrink-0 items-center justify-center" aria-hidden="true">
        {spec.pulse && (
          <span className={cn('absolute inline-flex size-2 animate-ping rounded-full opacity-60', DOT_BG[spec.tone])} />
        )}
        <span className={cn('relative inline-flex size-2 rounded-full', DOT_BG[spec.tone])} />
      </span>
      {t(spec.labelKey)}
    </span>
  )
}

/** A friendly one-line summary of the daemon we're talking to. */
function daemonSummary(host: Host, health?: { daemonVersion?: string | null, daemonHostId?: string | null }): string | null {
  const platform = host.lastPlatform
  const version = health?.daemonVersion ?? host.lastDaemonVersion
  const parts: string[] = []
  if (platform) {
    parts.push(platform)
  }
  if (version) {
    parts.push(`daemon v${version}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

function CopyCodeButton({ command }: { command: string }) {
  const { t } = useTranslation('settings')
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      toastManager.add({ type: 'success', title: t('remoteHosts.guide.commandCopied' as SettingsKey) })
      setTimeout(() => setCopied(false), 1500)
    }
    catch {
      toastManager.add({ type: 'error', title: t('remoteHosts.guide.copyFailed' as SettingsKey) })
    }
  }

  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-muted/40">
      <pre className="overflow-x-auto px-3 py-2 pr-9 font-mono text-[11.5px] leading-relaxed text-foreground/85">
        <code>{command}</code>
      </pre>
      <Button
        size="icon-xs"
        variant="ghost"
        onClick={copy}
        aria-label={t('remoteHosts.guide.copy' as SettingsKey)}
        className="absolute right-1.5 top-1.5"
      >
        {copied
          ? <CheckIcon className="size-3.5 text-emerald-500" aria-hidden="true" />
          : <CopyIcon className="size-3.5" aria-hidden="true" />}
      </Button>
    </div>
  )
}

function GuideStep({ index, title, isLast, children }: { index: number, title: string, isLast?: boolean, children: React.ReactNode }) {
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {/* Connecting line between step badges */}
      {!isLast && (
        <span className="absolute left-[11px] top-6 h-[calc(100%-1rem)] w-px bg-border/70" aria-hidden="true" />
      )}
      <span className="relative z-10 mt-px flex size-[22px] shrink-0 items-center justify-center rounded-full border border-border bg-card text-[11px] font-semibold text-foreground">
        {index}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-[12.5px] font-medium leading-tight text-foreground">{title}</p>
        {children}
      </div>
    </li>
  )
}

/**
 * The 3-step setup guide. Rendered as the empty state, and available on demand
 * (via a collapsible) once hosts exist.
 */
function SetupGuide({ onAdd }: { onAdd?: () => void }) {
  const { t } = useTranslation('settings')
  return (
    <ol className="space-y-0">
      <GuideStep
        index={1}
        title={t('remoteHosts.guide.step1.title' as SettingsKey)}
      >
        <p className="text-[12px] leading-relaxed text-muted-foreground/80">
          {t('remoteHosts.guide.step1.detail' as SettingsKey)}
        </p>
        <CopyCodeButton command="cradle-agentd" />
      </GuideStep>

      <GuideStep
        index={2}
        title={t('remoteHosts.guide.step2.title' as SettingsKey)}
      >
        <p className="text-[12px] leading-relaxed text-muted-foreground/80">
          {t('remoteHosts.guide.step2.detail' as SettingsKey)}
        </p>
        <CopyCodeButton command="CRADLE_AGENTD_WORKSPACE_ROOTS=~/projects cradle-agentd" />
      </GuideStep>

      <GuideStep
        index={3}
        isLast
        title={t('remoteHosts.guide.step3.title' as SettingsKey)}
      >
        <p className="text-[12px] leading-relaxed text-muted-foreground/80">
          {t('remoteHosts.guide.step3.detail' as SettingsKey)}
        </p>
        {onAdd && (
          <Button size="sm" onClick={onAdd}>
            <PlusIcon className="size-3.5" aria-hidden="true" />
            {t('remoteHosts.action.addHost' as SettingsKey)}
          </Button>
        )}
      </GuideStep>
    </ol>
  )
}

/** Centered welcome empty state with the setup guide. */
function RemoteHostsEmptyState({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation('settings')
  return (
    <div className="flex flex-col items-center gap-7 rounded-xl border border-dashed border-foreground/10 bg-muted/20 px-6 py-12 text-center">
      <div className="flex size-11 items-center justify-center rounded-2xl bg-foreground/5 text-foreground/70">
        <ServerIcon className="size-5" aria-hidden="true" />
      </div>
      <div className="max-w-md space-y-2">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
          {t('remoteHosts.empty.title' as SettingsKey)}
        </h2>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          {t('remoteHosts.guide.intro' as SettingsKey)}
        </p>
      </div>
      <div className="w-full max-w-md text-left">
        <SetupGuide onAdd={onAdd} />
      </div>
    </div>
  )
}

function DetailSection({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">{label}</h4>
      {children}
    </div>
  )
}

function EmptyInline({ text }: { text: string }) {
  return <p className="text-[11.5px] text-muted-foreground/60">{text}</p>
}

/** Expanded detail panel for a connected host. */
function HostDetail({ host }: { host: Host }) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const hostOpts = { path: { hostId: host.id } }
  const connected = host.connectionState === 'connected'

  const healthQuery = useQuery({
    ...getRemoteRuntimeHostsByHostIdHealthOptions(hostOpts),
    enabled: connected,
    retry: false,
  })
  const runtimesQuery = useQuery({
    ...getRemoteRuntimeHostsByHostIdRuntimesOptions(hostOpts),
    enabled: connected,
    retry: false,
  })
  const workspacesQuery = useQuery({
    ...getRemoteRuntimeHostsByHostIdWorkspacesOptions(hostOpts),
    enabled: connected,
    retry: false,
  })
  const agentsQuery = useQuery({
    ...getRemoteRuntimeHostsByHostIdAgentsOptions(hostOpts),
    enabled: connected,
    retry: false,
  })

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: getRemoteRuntimeHostsByHostIdHealthQueryKey(hostOpts) })
    void queryClient.invalidateQueries({ queryKey: getRemoteRuntimeHostsByHostIdRuntimesQueryKey(hostOpts) })
    void queryClient.invalidateQueries({ queryKey: getRemoteRuntimeHostsByHostIdWorkspacesQueryKey(hostOpts) })
    void queryClient.invalidateQueries({ queryKey: getRemoteRuntimeHostsByHostIdAgentsQueryKey(hostOpts) })
  }

  const importWorkspace = useMutation({
    mutationFn: async (workspace: { name: string, path: string }) => {
      const { error } = await postWorkspaces({
        body: { name: workspace.name, path: workspace.path },
      })
      if (error) {
        throw error
      }
    },
    onSuccess: (_data, workspace) => {
      toastManager.add({ type: 'success', title: t('remoteHosts.workspace.imported', { name: workspace.name }) })
    },
    onError: (error, workspace) => {
      const message = describeError(error)
      // 409 from the server means the path is already registered — treat as success-ish.
      if (/already|exists|409|conflict/i.test(message)) {
        toastManager.add({ type: 'info', title: t('remoteHosts.workspace.alreadyRegistered', { name: workspace.name }) })
        return
      }
      toastManager.add({
        type: 'error',
        title: t('remoteHosts.workspace.importFailed' as SettingsKey),
        description: message,
      })
    },
  })

  if (!connected) {
    return (
      <p className="text-[11.5px] text-muted-foreground/70">
        {t('remoteHosts.detail.connectToBrowse' as SettingsKey)}
      </p>
    )
  }

  const loadingAny = healthQuery.isLoading || runtimesQuery.isLoading || workspacesQuery.isLoading || agentsQuery.isLoading
  const runtimes = runtimesQuery.data?.runtimes ?? []
  const workspaces = workspacesQuery.data?.workspaces ?? []
  const agents = agentsQuery.data?.agents ?? []
  const summary = daemonSummary(host, healthQuery.data)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ConnectionDot state={host.connectionState} />
          {summary && <span className="text-[11px] text-muted-foreground/70">{summary}</span>}
        </div>
        <Button size="icon-xs" variant="ghost" onClick={refreshAll} aria-label={t('remoteHosts.action.refresh' as SettingsKey)}>
          <RefreshIcon className="size-3.5" aria-hidden="true" />
        </Button>
      </div>

      {host.lastError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[11px] text-destructive">
          {host.lastError}
        </p>
      )}

      <DetailSection label={t('remoteHosts.detail.runtimes' as SettingsKey)}>
        {loadingAny
          ? <EmptyInline text={t('remoteHosts.detail.loading' as SettingsKey)} />
          : runtimes.length === 0
            ? <EmptyInline text={t('remoteHosts.detail.noRuntimes' as SettingsKey)} />
            : (
                <div className="flex flex-col gap-1">
                  {runtimes.map(runtime => (
                    <div key={runtime.runtimeKind} className="flex items-center justify-between gap-2 text-[11.5px]">
                      <span className="font-mono text-foreground/80">{runtime.label || runtime.runtimeKind}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          'h-4 px-1.5 text-[9px] font-normal',
                          runtime.status === 'available'
                            ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                            : 'border-border text-muted-foreground',
                        )}
                      >
                        {t(`remoteHosts.runtime.${runtime.status}` as SettingsKey)}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
      </DetailSection>

      <DetailSection label={t('remoteHosts.detail.workspaces' as SettingsKey)}>
        {loadingAny
          ? <EmptyInline text={t('remoteHosts.detail.loading' as SettingsKey)} />
          : workspaces.length === 0
            ? <EmptyInline text={t('remoteHosts.detail.noWorkspaces' as SettingsKey)} />
            : (
                <div className="flex flex-col gap-1">
                  {workspaces.map(workspace => (
                    <div key={workspace.id || workspace.path} className="flex items-center justify-between gap-2 text-[11.5px]">
                      <div className="min-w-0">
                        <div className="truncate text-foreground/80">{workspace.name}</div>
                        <div className="truncate font-mono text-[10.5px] text-muted-foreground/60">{workspace.path}</div>
                      </div>
                      <Button
                        size="xs"
                        variant="ghost"
                        className="h-6 shrink-0 px-2 text-[10.5px]"
                        disabled={importWorkspace.isPending && importWorkspace.variables?.path === workspace.path}
                        onClick={() => importWorkspace.mutate({ name: workspace.name, path: workspace.path })}
                      >
                        {importWorkspace.isPending && importWorkspace.variables?.path === workspace.path
                          ? <Spinner className="size-3" />
                          : t('remoteHosts.workspace.import' as SettingsKey)}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
      </DetailSection>

      <DetailSection label={t('remoteHosts.detail.agents' as SettingsKey)}>
        {loadingAny
          ? <EmptyInline text={t('remoteHosts.detail.loading' as SettingsKey)} />
          : agents.length === 0
            ? <EmptyInline text={t('remoteHosts.detail.noAgents' as SettingsKey)} />
            : (
                <div className="flex flex-col gap-1">
                  {agents.map(agent => (
                    <div key={agent.agentId} className="flex items-center justify-between gap-2 text-[11.5px]">
                      <div className="min-w-0">
                        <div className="truncate font-mono text-foreground/80">{agent.runtimeKind}</div>
                        <div className="truncate font-mono text-[10.5px] text-muted-foreground/60">{agent.workspacePath}</div>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          'h-4 shrink-0 px-1.5 text-[9px] font-normal',
                          agent.status === 'running'
                            ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                            : agent.status === 'failed'
                              ? 'border-destructive/40 text-destructive'
                              : 'border-border text-muted-foreground',
                        )}
                      >
                        {t(`remoteHosts.agent.${agent.status}` as SettingsKey)}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
      </DetailSection>
    </div>
  )
}

function HostRow({ host }: { host: Host }) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const invalidateHosts = () => {
    void queryClient.invalidateQueries({ queryKey: getRemoteRuntimeHostsQueryKey() })
  }

  const connect = useMutation({
    mutationFn: async () => {
      const { error } = await postRemoteRuntimeHostsByHostIdConnect({ path: { hostId: host.id } })
      if (error) {
        throw error
      }
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('remoteHosts.toast.connected' as SettingsKey) })
      invalidateHosts()
    },
    onError: error => toastManager.add({
      type: 'error',
      title: t('remoteHosts.toast.connectFailed' as SettingsKey),
      description: describeError(error),
    }),
  })

  const disconnect = useMutation({
    mutationFn: async () => {
      const { error } = await postRemoteRuntimeHostsByHostIdDisconnect({ path: { hostId: host.id } })
      if (error) {
        throw error
      }
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('remoteHosts.toast.disconnected' as SettingsKey) })
      invalidateHosts()
    },
    onError: error => toastManager.add({
      type: 'error',
      title: t('remoteHosts.toast.disconnectFailed' as SettingsKey),
      description: describeError(error),
    }),
  })

  const deleteHost = useMutation({
    mutationFn: async () => {
      const { error } = await deleteRemoteRuntimeHostsByHostId({ path: { hostId: host.id } })
      if (error) {
        throw error
      }
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('remoteHosts.toast.deleted' as SettingsKey) })
      invalidateHosts()
    },
    onError: error => toastManager.add({
      type: 'error',
      title: t('remoteHosts.toast.deleteFailed' as SettingsKey),
      description: describeError(error),
    }),
  })

  const isConnected = host.connectionState === 'connected'
  const busy = connect.isPending || disconnect.isPending || deleteHost.isPending

  return (
    <div data-testid={`remote-host-row-${host.id}`}>
      <div className="group flex items-center gap-3 px-3.5 py-3">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
          <ServerIcon className="size-3.5" aria-hidden="true" />
        </div>
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={expanded}
        >
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[12.5px] font-medium text-foreground">{host.displayName}</span>
              {!host.enabled && (
                <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-normal text-muted-foreground">
                  {t('remoteHosts.badge.disabled' as SettingsKey)}
                </Badge>
              )}
              <ConnectionDot state={host.connectionState} />
            </div>
            <div className="truncate font-mono text-[11px] text-muted-foreground/70">{host.sshTarget}</div>
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {isConnected
            ? (
                <Button
                  size="xs"
                  variant="ghost"
                  className="h-7 px-2.5 text-[11px]"
                  disabled={busy}
                  onClick={() => disconnect.mutate()}
                >
                  {disconnect.isPending ? <Spinner className="size-3" /> : null}
                  {t('remoteHosts.action.disconnect' as SettingsKey)}
                </Button>
              )
            : (
                <Button
                  size="xs"
                  variant="outline"
                  className="h-7 px-2.5 text-[11px]"
                  disabled={busy || !host.enabled}
                  onClick={() => connect.mutate()}
                >
                  {connect.isPending ? <Spinner className="size-3" /> : null}
                  {t('remoteHosts.action.connect' as SettingsKey)}
                </Button>
              )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-xs" variant="ghost" onClick={() => setEditing(true)} aria-label={t('remoteHosts.action.edit' as SettingsKey)}>
                <PencilIcon className="size-3.5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{t('remoteHosts.action.edit' as SettingsKey)}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => setConfirmingDelete(true)}
                disabled={busy}
                aria-label={t('remoteHosts.action.delete' as SettingsKey)}
              >
                {deleteHost.isPending ? <Spinner className="size-3.5" /> : <TrashIcon className="size-3.5" aria-hidden="true" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{t('remoteHosts.action.delete' as SettingsKey)}</TooltipContent>
          </Tooltip>

          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => setExpanded(v => !v)}
            aria-label={expanded ? t('remoteHosts.action.collapse' as SettingsKey) : t('remoteHosts.action.expand' as SettingsKey)}
          >
            <ChevronIcon className={cn('size-3.5 transition-transform', expanded ? 'rotate-0' : '-rotate-90')} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border/60 bg-muted/20 px-3.5 py-3.5">
          <HostDetail host={host} />
        </div>
      )}

      {editing && (
        <HostFormDialog
          open
          onOpenChange={open => !open && setEditing(false)}
          host={host}
        />
      )}

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('remoteHosts.delete.title' as SettingsKey)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('remoteHosts.delete.description', { name: host.displayName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('remoteHosts.action.cancel' as SettingsKey)}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                deleteHost.mutate()
              }}
            >
              {t('remoteHosts.action.delete' as SettingsKey)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

interface HostFormValues {
  displayName: string
  sshTarget: string
  remoteSocketPath: string
  enabled: boolean
}

function initialHostFormValues(host?: Host): HostFormValues {
  return {
    displayName: host?.displayName ?? '',
    sshTarget: host?.sshTarget ?? '',
    remoteSocketPath: host?.remoteSocketPath ?? DEFAULT_REMOTE_SOCKET_PATH,
    enabled: host?.enabled ?? true,
  }
}

function HostFormDialog({
  open,
  onOpenChange,
  host,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  host?: Host
}) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const [values, setValues] = useState<HostFormValues>(() => initialHostFormValues(host))
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // Re-seed the form each time the dialog opens so the always-mounted "Add host"
  // dialog does not retain the previous submission's values.
  useEffect(() => {
    if (open) {
      setValues(initialHostFormValues(host))
      setAdvancedOpen(false)
    }
  }, [open, host])

  const set = (patch: Partial<HostFormValues>) => setValues(prev => ({ ...prev, ...patch }))

  const valid = values.displayName.trim().length > 0
    && values.sshTarget.trim().length > 0
    && values.remoteSocketPath.trim().length > 0

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        displayName: values.displayName.trim(),
        sshTarget: values.sshTarget.trim(),
        remoteSocketPath: values.remoteSocketPath.trim(),
        enabled: values.enabled,
      }
      if (host) {
        const { error } = await patchRemoteRuntimeHostsByHostId({
          path: { hostId: host.id },
          body,
        })
        if (error) {
          throw error
        }
      }
      else {
        const { error } = await postRemoteRuntimeHosts({
          body,
        })
        if (error) {
          throw error
        }
      }
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t(host ? 'remoteHosts.toast.updated' as SettingsKey : 'remoteHosts.toast.created' as SettingsKey) })
      void queryClient.invalidateQueries({ queryKey: getRemoteRuntimeHostsQueryKey() })
      onOpenChange(false)
    },
    onError: error => toastManager.add({
      type: 'error',
      title: t('remoteHosts.toast.saveFailed' as SettingsKey),
      description: describeError(error),
    }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(host ? 'remoteHosts.form.editTitle' as SettingsKey : 'remoteHosts.form.addTitle' as SettingsKey)}</DialogTitle>
          <DialogDescription>{t('remoteHosts.form.description' as SettingsKey)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label htmlFor="rh-display-name" className="text-xs">{t('remoteHosts.form.displayName' as SettingsKey)}</Label>
            <Input
              id="rh-display-name"
              value={values.displayName}
              onChange={e => set({ displayName: e.target.value })}
              placeholder={t('remoteHosts.form.displayNamePlaceholder' as SettingsKey)}
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="rh-ssh-target" className="text-xs">{t('remoteHosts.form.sshTarget' as SettingsKey)}</Label>
            <Input
              id="rh-ssh-target"
              value={values.sshTarget}
              onChange={e => set({ sshTarget: e.target.value })}
              placeholder={t('remoteHosts.form.sshTargetPlaceholder' as SettingsKey)}
              className="h-8 font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">{t('remoteHosts.form.sshTargetHint' as SettingsKey)}</p>
          </div>

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronIcon className={cn('size-3.5 transition-transform', advancedOpen ? 'rotate-0' : '-rotate-90')} aria-hidden="true" />
                {t('remoteHosts.form.advanced' as SettingsKey)}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-2 pt-3">
              <Label htmlFor="rh-socket-path" className="text-xs">{t('remoteHosts.form.remoteSocketPath' as SettingsKey)}</Label>
              <Input
                id="rh-socket-path"
                value={values.remoteSocketPath}
                onChange={e => set({ remoteSocketPath: e.target.value })}
                placeholder={DEFAULT_REMOTE_SOCKET_PATH}
                className="h-8 font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground">{t('remoteHosts.form.remoteSocketPathHint' as SettingsKey)}</p>
            </CollapsibleContent>
          </Collapsible>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 px-3 py-2.5">
            <div className="space-y-0.5">
              <Label className="text-xs">{t('remoteHosts.form.enabled' as SettingsKey)}</Label>
              <p className="text-[11px] text-muted-foreground">{t('remoteHosts.form.enabledHint' as SettingsKey)}</p>
            </div>
            <Switch checked={values.enabled} onCheckedChange={v => set({ enabled: v })} size="sm" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="h-7 text-xs">
            {t('remoteHosts.action.cancel' as SettingsKey)}
          </Button>
          <Button size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate()} className="h-7 text-xs">
            {save.isPending && <Spinner className="size-3.5" />}
            {t(host ? 'remoteHosts.action.save' as SettingsKey : 'remoteHosts.action.add' as SettingsKey)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RemoteHostsSettings() {
  const { t } = useTranslation('settings')
  const [addOpen, setAddOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)

  const { data: hosts = [], isLoading } = useQuery(getRemoteRuntimeHostsOptions())

  return (
    <SettingsPage
      title={t('remoteHosts.page.title' as SettingsKey)}
      description={t('remoteHosts.page.description' as SettingsKey)}
      action={(
        <Button data-testid="add-remote-host-btn" size="sm" onClick={() => setAddOpen(true)}>
          <PlusIcon className="size-3.5" aria-hidden="true" />
          {t('remoteHosts.action.addHost' as SettingsKey)}
        </Button>
      )}
      data-testid="remote-hosts-settings"
    >
      {isLoading
        ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-10 text-[12px] text-muted-foreground">
              <Spinner className="size-3.5" />
              {t('remoteHosts.loading' as SettingsKey)}
            </div>
          )
        : hosts.length === 0
          ? (
              <RemoteHostsEmptyState onAdd={() => setAddOpen(true)} />
            )
          : (
              <>
                <Collapsible open={guideOpen} onOpenChange={setGuideOpen}>
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ChevronIcon className={cn('size-3.5 transition-transform', guideOpen ? 'rotate-0' : '-rotate-90')} aria-hidden="true" />
                      {t('remoteHosts.guide.toggle' as SettingsKey)}
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-4">
                    <div className="rounded-xl border border-border bg-card p-5">
                      <SetupGuide />
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <SettingsGroup bare className="[&>*+*]:border-t [&>*+*]:border-border/60">
                  {hosts.map(host => (
                    <HostRow key={host.id} host={host} />
                  ))}
                </SettingsGroup>
              </>
            )}

      <HostFormDialog open={addOpen} onOpenChange={setAddOpen} />
    </SettingsPage>
  )
}
