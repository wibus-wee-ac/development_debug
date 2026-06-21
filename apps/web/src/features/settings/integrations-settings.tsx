import {
  AddLine as AddIcon,
  BridgeLine as BridgeIcon,
  CodeLine as CodeIcon,
  CommandLine as TerminalIcon,
  DeleteLine as TrashIcon,
  Link3Line as LinkIcon,
  LoadingLine as LoaderIcon,
  More2Line as MoreIcon,
  PlayLine as PlayIcon,
  PuzzledLine as PuzzleIcon,
  Refresh2Line as RefreshIcon,
  StopLine as StopIcon,
  Settings2Line,
} from '@mingcute/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  deleteConversationBridgeConnectionsById,
  deleteConversationBridgeConnectionsByIdWorkspacesByExternalWorkspaceIdChannelsByExternalChannelIdBinding,
  getConversationBridgeAdapters,
  getConversationBridgeConnections,
  getConversationBridgeConnectionsByIdChannelBindings,
  getConversationBridgeConnectionsByIdThreads,
  getConversationBridgeDeliveryAttemptsRetryable,
  getSecrets,
  patchConversationBridgeConnectionsById,
  postConversationBridgeConnections,
  postConversationBridgeConnectionsByIdStart,
  postConversationBridgeConnectionsByIdStop,
  postConversationBridgeDeliveryAttemptsRetry,
  postSecrets,
  putConversationBridgeConnectionsByIdWorkspacesByExternalWorkspaceIdChannelsByExternalChannelIdBinding,
} from '~/api-gen/sdk.gen'
import type {
  GetConversationBridgeAdaptersResponse,
  GetConversationBridgeConnectionsResponse,
  GetConversationBridgeConnectionsByIdChannelBindingsResponse,
  GetConversationBridgeConnectionsByIdThreadsResponse,
  GetConversationBridgeDeliveryAttemptsRetryableResponse,
  GetSecretsResponse,
} from '~/api-gen/types.gen'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '~/components/ui/alert-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Checkbox } from '~/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '~/components/ui/dropdown-menu'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { toastManager } from '~/components/ui/toast'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { cn } from '~/lib/cn'

import { SettingsGroup, SettingsHeader, SettingsMasterDetail, SettingsPage } from './settings-container'
import { useAppPreferences } from './use-app-preferences'

type Adapter = GetConversationBridgeAdaptersResponse[number]
type Connection = GetConversationBridgeConnectionsResponse[number]
type ChannelBinding = GetConversationBridgeConnectionsByIdChannelBindingsResponse[number]
type ThreadBinding = GetConversationBridgeConnectionsByIdThreadsResponse[number]
type DeliveryAttempt = GetConversationBridgeDeliveryAttemptsRetryableResponse[number]
type Secret = GetSecretsResponse[number]

type HealthStatus = 'unknown' | 'starting' | 'running' | 'stopped' | 'error'

const queryKeys = {
  adapters: ['conversation-bridge', 'adapters'] as const,
  connections: ['conversation-bridge', 'connections'] as const,
  connection: (id: string) => ['conversation-bridge', 'connections', id] as const,
  channelBindings: (id: string) => ['conversation-bridge', 'connections', id, 'channel-bindings'] as const,
  threads: (id: string) => ['conversation-bridge', 'connections', id, 'threads'] as const,
  retryableDeliveries: ['conversation-bridge', 'delivery-attempts', 'retryable'] as const,
  secrets: ['secrets'] as const,
}

// Status dot component with better visuals
function StatusDot({ status, pulse, size = 'md' }: { status: HealthStatus; pulse?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const dotClasses: Record<HealthStatus, string> = {
    unknown: 'bg-muted-foreground/40',
    starting: 'bg-warning',
    running: 'bg-success',
    stopped: 'bg-muted-foreground/40',
    error: 'bg-destructive',
  }

  const sizeClasses = {
    sm: 'size-1.5',
    md: 'size-2',
    lg: 'size-2.5',
  }

  return (
    <span className="relative flex items-center justify-center" aria-hidden="true">
      {pulse && status === 'running' && (
        <span className={cn('absolute inline-flex animate-ping rounded-full', dotClasses[status], 'opacity-40', sizeClasses[size === 'sm' ? 'md' : size === 'md' ? 'lg' : 'lg'])} />
      )}
      <span className={cn('relative inline-flex rounded-full', dotClasses[status], sizeClasses[size])} />
    </span>
  )
}

// Adapter mark component with gradient
function AdapterMark({ adapter, size = 'md' }: { adapter: Adapter; size?: 'sm' | 'md' | 'lg' }) {
  const initial = (adapter.label[0] ?? '?').toUpperCase()

  const sizeClasses = {
    sm: 'size-8 text-[11px]',
    md: 'size-10 text-[13px]',
    lg: 'size-12 text-[15px]',
  }

  // Pick a deterministic gradient based on adapter name
  const gradients = [
    'from-indigo-500 to-purple-500',
    'from-rose-500 to-orange-500',
    'from-cyan-500 to-blue-500',
    'from-emerald-500 to-teal-500',
    'from-violet-500 to-fuchsia-500',
  ]
  const gradientIndex = adapter.label.charCodeAt(0) % gradients.length

  return (
    <div className={cn(
      'flex shrink-0 items-center justify-center rounded-xl font-semibold text-white select-none',
      'bg-gradient-to-br shadow-sm shadow-black/10',
      gradients[gradientIndex],
      sizeClasses[size]
    )}>
      {initial}
    </div>
  )
}

// Time ago helper
function timeAgo(timestamp: number | null): string | null {
  if (!timestamp) return null
  const diff = Math.floor(Date.now() / 1000) - timestamp
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`
  return new Date(timestamp * 1000).toLocaleDateString()
}

function formatTimestamp(timestamp: number | null): string | null {
  if (!timestamp) return null
  return new Date(timestamp * 1000).toLocaleDateString()
}

// Health status label
function healthStatusLabel(status: HealthStatus, t: any): string {
  switch (status) {
    case 'unknown': return t('integrations.connection.healthUnknown')
    case 'starting': return t('integrations.connection.healthStarting')
    case 'running': return t('integrations.connection.healthRunning')
    case 'stopped': return t('integrations.connection.healthStopped')
    case 'error': return t('integrations.connection.healthError')
    default: return status
  }
}

// Integration card component - main entry point
function IntegrationCard({
  icon: Icon,
  title,
  description,
  badge,
  color = 'blue',
  onClick,
  rightContent,
}: {
  icon: any
  title: string
  description: string
  badge?: string
  color?: 'blue' | 'purple' | 'green' | 'orange' | 'rose' | 'cyan'
  onClick?: () => void
  rightContent?: React.ReactNode
}) {
  const colorClasses = {
    blue: 'from-blue-500 to-cyan-500 bg-blue-500/10 text-blue-500',
    purple: 'from-purple-500 to-pink-500 bg-purple-500/10 text-purple-500',
    green: 'from-emerald-500 to-teal-500 bg-emerald-500/10 text-emerald-500',
    orange: 'from-orange-500 to-amber-500 bg-orange-500/10 text-orange-500',
    rose: 'from-rose-500 to-red-500 bg-rose-500/10 text-rose-500',
    cyan: 'from-cyan-500 to-sky-500 bg-cyan-500/10 text-cyan-500',
  }

  return (
    <Card
      className={cn(
        'group overflow-hidden transition-all duration-200',
        'hover:border-border/80 hover:bg-accent/30 hover:shadow-md hover:shadow-black/5',
        onClick ? 'cursor-pointer' : ''
      )}
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-start gap-4 pb-4">
        <div className={cn(
          'flex size-12 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm shadow-black/10',
          colorClasses[color]
        )}>
          <Icon className="size-5 text-white" aria-hidden="true" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
            {badge && (
              <Badge
                variant="secondary"
                className="h-5 px-1.5 text-[10px] font-medium"
              >
                {badge}
              </Badge>
            )}
          </div>
          <CardDescription className="mt-1.5 text-[12px] leading-relaxed">{description}</CardDescription>
        </div>
        {rightContent && (
          <div className="flex items-center">
            {rightContent}
          </div>
        )}
      </CardHeader>
    </Card>
  )
}

// Provider integration view component
function ProviderIntegrationView({
  onBack,
  prefs,
  prefsLoading,
  isSaving,
  saveFeatureFlags,
}: {
  onBack: () => void
  prefs: ReturnType<typeof useAppPreferences>['prefs']
  prefsLoading: boolean
  isSaving: boolean
  saveFeatureFlags: (flags: any) => void
}) {
  const { t } = useTranslation('settings')

  return (
    <SettingsPage
      title={t('integrations.categories.provider.title')}
      description={t('integrations.categories.provider.description')}
      maxWidth="2xl"
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="mb-4 w-fit text-xs"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1"><path d="m15 18-6-6 6-6"/></svg>
        Back
      </Button>
      <div className="space-y-6">
        {/* Provider native skill roots setting */}
        <SettingsGroup label="Provider Native Skills">
          <div className="p-4">
            <div className="flex items-start justify-between gap-6">
              <div className="space-y-1.5 flex-1">
                <div className="flex items-center gap-2">
                  <Label htmlFor="native-skill-roots" className="text-sm font-medium">
                    {t('features.nativeProviderSkillProjection.label')}
                  </Label>
                  <Badge variant="secondary" className="text-[10px]">Recommended</Badge>
                </div>
                <p className="text-[12px] text-muted-foreground leading-relaxed">
                  {t('features.nativeProviderSkillProjection.description')}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[10px] text-muted-foreground">
                    <TerminalIcon className="size-3.5" />
                    ~/.codex/skills/cradle
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[10px] text-muted-foreground">
                    <TerminalIcon className="size-3.5" />
                    ~/.claude/skills/cradle
                  </span>
                </div>
              </div>
              <Switch
                id="native-skill-roots"
                size="sm"
                checked={prefs?.featureFlags.nativeProviderSkillProjection ?? false}
                disabled={prefsLoading || isSaving}
                onCheckedChange={(checked) => saveFeatureFlags({ nativeProviderSkillProjection: checked })}
                className="mt-0.5"
              />
            </div>
          </div>
        </SettingsGroup>

        {/* Info card */}
        <Card className="border-border/60 bg-accent/30">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-background">
                <Settings2Line className="size-4 text-amber-500" aria-hidden="true" />
              </div>
              <div>
                <CardTitle className="text-xs font-medium">How it works</CardTitle>
              </div>
            </div>
          </CardHeader>
          <CardContent className="text-[12px] text-muted-foreground space-y-2">
            <p>When enabled, Cradle will symlink your enabled plugins and built-in skills into the native skill directories of your AI providers.</p>
            <p>This allows Codex and Claude to discover and use your Cradle skills even when you're using them outside of Cradle.</p>
          </CardContent>
        </Card>
      </div>
    </SettingsPage>
  )
}

// Connections view component
function ConnectionsView({
  onBack,
  selectedConnectionId,
  onSelectConnection,
  showCreateDialog,
  setShowCreateDialog,
  showRetryDialog,
  setShowRetryDialog,
  deletingConnectionId,
  setDeletingConnectionId,
}: {
  onBack: () => void
  selectedConnectionId: string | null
  onSelectConnection: (id: string | null) => void
  showCreateDialog: boolean
  setShowCreateDialog: (v: boolean) => void
  showRetryDialog: boolean
  setShowRetryDialog: (v: boolean) => void
  deletingConnectionId: string | null
  setDeletingConnectionId: (v: string | null) => void
}) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()

  // Queries
  const adaptersQuery = useQuery({
    queryKey: queryKeys.adapters,
    queryFn: async () => {
      const { data, error } = await getConversationBridgeAdapters()
      if (error) throw new Error(String(error))
      return data ?? []
    },
  })

  const connectionsQuery = useQuery({
    queryKey: queryKeys.connections,
    queryFn: async () => {
      const { data, error } = await getConversationBridgeConnections()
      if (error) throw new Error(String(error))
      return data ?? []
    },
  })

  const secretsQuery = useQuery({
    queryKey: queryKeys.secrets,
    queryFn: async () => {
      const { data, error } = await getSecrets()
      if (error) throw new Error(String(error))
      return data ?? []
    },
  })

  // Mutations
  const startMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await postConversationBridgeConnectionsByIdStart({ path: { id } })
      if (error) throw new Error(String(error))
      return data
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('integrations.connection.toast.started') })
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections })
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('integrations.connection.toast.startFailed') })
    },
  })

  const stopMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await postConversationBridgeConnectionsByIdStop({ path: { id } })
      if (error) throw new Error(String(error))
      return data
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('integrations.connection.toast.stopped') })
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections })
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('integrations.connection.toast.stopFailed') })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await deleteConversationBridgeConnectionsById({ path: { id } })
      if (error) throw new Error(String(error))
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('integrations.connection.toast.deleted') })
      onSelectConnection(null)
      setDeletingConnectionId(null)
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections })
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('integrations.connection.toast.deleteFailed') })
    },
  })

  const handleStart = (connection: Connection) => {
    void startMutation.mutate(connection.id)
  }

  const handleStop = (connection: Connection) => {
    void stopMutation.mutate(connection.id)
  }

  const handleDelete = (connection: Connection) => {
    setDeletingConnectionId(connection.id)
  }

  const confirmDelete = () => {
    if (deletingConnectionId) {
      void deleteMutation.mutate(deletingConnectionId)
    }
  }

  const handleConnectionCreated = () => {
    setShowCreateDialog(false)
    void queryClient.invalidateQueries({ queryKey: queryKeys.connections })
  }

  const handleRetryDeliveries = () => {
    setShowRetryDialog(true)
  }

  const handleDeliveriesRetried = () => {
    setShowRetryDialog(false)
    void queryClient.invalidateQueries({ queryKey: queryKeys.retryableDeliveries })
  }

  // Derived state
  const adapters = useMemo(() => adaptersQuery.data ?? [], [adaptersQuery.data])
  const connections = useMemo(() => connectionsQuery.data ?? [], [connectionsQuery.data])
  const secrets = useMemo(() => secretsQuery.data ?? [], [secretsQuery.data])

  const selectedConnection = useMemo(
    () => connections.find(c => c.id === selectedConnectionId) ?? null,
    [connections, selectedConnectionId]
  )

  // Group connections by adapter
  const connectionsByAdapter = useMemo(() => {
    const map = new Map<string, Connection[]>()
    for (const adapter of adapters) {
      map.set(adapter.id, connections.filter(c => c.adapterId === adapter.id && c.adapterOwner === adapter.owner))
    }
    return map
  }, [adapters, connections])

  const connectedCount = connections.filter(c => c.healthStatus === 'running').length
  const errorCount = connections.filter(c => c.healthStatus === 'error').length

  const isLoading = adaptersQuery.isLoading || connectionsQuery.isLoading || secretsQuery.isLoading

  return (
    <SettingsMasterDetail
      title={t('integrations.categories.connections.title')}
      description={t('integrations.categories.connections.description')}
      toolbar={
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="mb-2 w-fit text-xs"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1"><path d="m15 18-6-6 6-6"/></svg>
          Back
        </Button>
      }
      list={
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowCreateDialog(true)}
              className="h-7 gap-1.5 text-xs"
              disabled={adapters.length === 0}
            >
              <AddIcon className="size-3.5" aria-hidden="true" />
              {t('integrations.connection.create')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void adaptersQuery.refetch()
                void connectionsQuery.refetch()
              }}
              className="h-7 gap-1.5 text-xs"
            >
              <RefreshIcon className={cn('size-3.5', isLoading && 'animate-spin')} aria-hidden="true" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
                <Spinner className="size-3.5" />
              </div>
            ) : adapters.length === 0 ? (
              <div className="border-y border-border/60 bg-muted/20 px-4 py-8 text-center text-xs text-muted-foreground/70">
                {t('integrations.adapter.empty')}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 p-2">
                {adapters.map(adapter => (
                  <AdapterSection
                    key={`${adapter.owner}-${adapter.id}`}
                    adapter={adapter}
                    connections={connectionsByAdapter.get(adapter.id) ?? []}
                    selectedConnectionId={selectedConnectionId}
                    onSelectConnection={onSelectConnection}
                    onStart={handleStart}
                    onStop={handleStop}
                    onDelete={handleDelete}
                    startingId={startMutation.variables}
                    stoppingId={stopMutation.variables}
                  />
                ))}
                {connections.length === 0 && (
                  <div className="mt-4 rounded-xl border border-dashed border-foreground/10 bg-muted/20 px-4 py-8 text-center">
                    <LinkIcon className="mx-auto size-6 text-muted-foreground/40" aria-hidden="true" />
                    <p className="mt-3 text-xs text-muted-foreground">{t('integrations.connection.empty')}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      }
      detail={
        selectedConnection ? (
          <ConnectionDetail
            connection={selectedConnection}
            secrets={secrets}
            onUpdated={() => queryClient.invalidateQueries({ queryKey: queryKeys.connections })}
            onRetryDeliveries={handleRetryDeliveries}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-xs text-muted-foreground">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-muted/30">
              <LinkIcon className="size-5 text-muted-foreground/50" aria-hidden="true" />
            </div>
            <div className="text-center">
              <p className="font-medium text-foreground">Select a connection</p>
              <p className="mt-1 text-[11px]">{t('integrations.connection.selectPlaceholder')}</p>
            </div>
          </div>
        )
      }
    >
      <CreateConnectionDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        adapters={adapters}
        secrets={secrets}
        onCreated={handleConnectionCreated}
      />

      <RetryDeliveriesDialog
        open={showRetryDialog}
        onOpenChange={setShowRetryDialog}
        onRetried={handleDeliveriesRetried}
      />

      <AlertDialog
        open={!!deletingConnectionId}
        onOpenChange={(open) => !open && setDeletingConnectionId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('integrations.connection.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('integrations.connection.deleteConfirmDescription', {
                displayName: connections.find(c => c.id === deletingConnectionId)?.displayName ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('integrations.connection.deleteConfirmCancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Spinner className="size-3.5 mr-1" />}
              {t('integrations.connection.deleteConfirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsMasterDetail>
  )
}

// Adapter section component
function AdapterSection({
  adapter,
  connections,
  selectedConnectionId,
  onSelectConnection,
  onStart,
  onStop,
  onDelete,
  startingId,
  stoppingId,
}: {
  adapter: Adapter
  connections: Connection[]
  selectedConnectionId: string | null
  onSelectConnection: (id: string) => void
  onStart: (connection: Connection) => void
  onStop: (connection: Connection) => void
  onDelete: (connection: Connection) => void
  startingId: string | undefined
  stoppingId: string | undefined
}) {
  const { t } = useTranslation('settings')
  const isAvailable = true

  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <AdapterMark adapter={adapter} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn('truncate text-xs font-medium', isAvailable ? 'text-foreground' : 'text-muted-foreground')}>
              {adapter.label}
            </span>
            {!isAvailable && <Badge variant="outline" className="text-[10px]">{t('integrations.adapter.unavailable')}</Badge>}
          </div>
          {adapter.description && (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{adapter.description}</p>
          )}
        </div>
        {connections.length > 0 && (
          <span className="inline-flex items-center rounded-md bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums">
            {connections.length}
          </span>
        )}
      </div>

      {isAvailable && connections.length > 0 && (
        <div className="border-t border-border/60">
          {connections.map(connection => (
            <ConnectionRow
              key={connection.id}
              connection={connection}
              selected={selectedConnectionId === connection.id}
              onSelect={() => onSelectConnection(connection.id)}
              onStart={() => onStart(connection)}
              onStop={() => onStop(connection)}
              onDelete={() => onDelete(connection)}
              starting={startingId === connection.id}
              stopping={stoppingId === connection.id}
            />
          ))}
        </div>
      )}
    </section>
  )
}

// Connection row component with better visuals
function ConnectionRow({
  connection,
  selected,
  onSelect,
  onStart,
  onStop,
  onDelete,
  starting,
  stopping,
}: {
  connection: Connection
  selected: boolean
  onSelect: () => void
  onStart: () => void
  onStop: () => void
  onDelete: () => void
  starting: boolean
  stopping: boolean
}) {
  const { t } = useTranslation('settings')

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
        selected ? 'bg-accent/60' : 'hover:bg-accent/30'
      )}
    >
      <StatusDot
        status={connection.healthStatus}
        pulse={connection.healthStatus === 'running'}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <span className="truncate text-xs font-medium text-foreground">{connection.displayName}</span>
        <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
          <span>{healthStatusLabel(connection.healthStatus, t)}</span>
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={(e) => e.stopPropagation()}
            className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
          >
            <MoreIcon className="size-3.5" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          {connection.healthStatus !== 'running' && (
            <DropdownMenuItem
              onClick={(e) => { e.stopPropagation(); onStart() }}
              disabled={starting}
            >
              <PlayIcon className="mr-2 size-3.5" aria-hidden="true" />
              {starting ? t('integrations.connection.starting') : t('integrations.connection.start')}
            </DropdownMenuItem>
          )}
          {connection.healthStatus === 'running' && (
            <DropdownMenuItem
              onClick={(e) => { e.stopPropagation(); onStop() }}
              disabled={stopping}
            >
              <StopIcon className="mr-2 size-3.5" aria-hidden="true" />
              {stopping ? t('integrations.connection.stopping') : t('integrations.connection.stop')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={(e) => { e.stopPropagation(); onDelete() }}
          >
            <TrashIcon className="mr-2 size-3.5" aria-hidden="true" />
            {t('integrations.connection.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </button>
  )
}

// Connection detail component
function ConnectionDetail({
  connection,
  secrets,
  onUpdated,
  onRetryDeliveries,
}: {
  connection: Connection
  secrets: Secret[]
  onUpdated: () => void
  onRetryDeliveries: () => void
}) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()

  const [displayName, setDisplayName] = useState(connection.displayName)
  const [enabled, setEnabled] = useState(connection.enabled)
  const [isEditing, setIsEditing] = useState(false)

  const channelBindingsQuery = useQuery({
    queryKey: queryKeys.channelBindings(connection.id),
    queryFn: async () => {
      const { data, error } = await getConversationBridgeConnectionsByIdChannelBindings({ path: { id: connection.id } })
      if (error) throw new Error(String(error))
      return data ?? []
    },
  })

  const threadsQuery = useQuery({
    queryKey: queryKeys.threads(connection.id),
    queryFn: async () => {
      const { data, error } = await getConversationBridgeConnectionsByIdThreads({ path: { id: connection.id } })
      if (error) throw new Error(String(error))
      return data ?? []
    },
  })

  const retryableDeliveriesQuery = useQuery({
    queryKey: queryKeys.retryableDeliveries,
    queryFn: async () => {
      const { data, error } = await getConversationBridgeDeliveryAttemptsRetryable()
      if (error) throw new Error(String(error))
      return (data ?? []).filter(d => d.connectionId === connection.id)
    },
  })

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await patchConversationBridgeConnectionsById({
        path: { id: connection.id },
        body: { displayName, enabled },
      })
      if (error) throw new Error(String(error))
      return data
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('integrations.connection.toast.updated') })
      setIsEditing(false)
      void onUpdated()
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('integrations.connection.toast.updateFailed') })
    },
  })

  const startMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await postConversationBridgeConnectionsByIdStart({ path: { id: connection.id } })
      if (error) throw new Error(String(error))
      return data
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('integrations.connection.toast.started') })
      void onUpdated()
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('integrations.connection.toast.startFailed') })
    },
  })

  const stopMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await postConversationBridgeConnectionsByIdStop({ path: { id: connection.id } })
      if (error) throw new Error(String(error))
      return data
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('integrations.connection.toast.stopped') })
      void onUpdated()
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('integrations.connection.toast.stopFailed') })
    },
  })

  const handleSave = () => {
    void updateMutation.mutate()
  }

  const handleCancel = () => {
    setDisplayName(connection.displayName)
    setEnabled(connection.enabled)
    setIsEditing(false)
  }

  const handleStart = () => {
    void startMutation.mutate()
  }

  const handleStop = () => {
    void stopMutation.mutate()
  }

  const invalidateBindings = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.channelBindings(connection.id) })
  }, [queryClient, connection.id])

  const isSlack = connection.platform === 'slack'

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Tabs defaultValue="config" className="flex-1">
        <div className="sticky top-0 z-10 border-b border-border/60 bg-background px-4 pt-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <StatusDot status={connection.healthStatus} pulse={connection.healthStatus === 'running'} />
                <h2 className="text-sm font-medium text-foreground">{connection.displayName}</h2>
              </div>
              <Badge variant="outline" className="text-[10px]">{connection.platform}</Badge>
            </div>
            <div className="flex items-center gap-1">
              {connection.healthStatus !== 'running' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleStart}
                  disabled={startMutation.isPending}
                  className="h-7 gap-1.5 text-xs"
                >
                  {startMutation.isPending && <Spinner className="size-3.5" />}
                  {!startMutation.isPending && <PlayIcon className="size-3.5" aria-hidden="true" />}
                  {t('integrations.connection.start')}
                </Button>
              )}
              {connection.healthStatus === 'running' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleStop}
                  disabled={stopMutation.isPending}
                  className="h-7 gap-1.5 text-xs"
                >
                  {stopMutation.isPending && <Spinner className="size-3.5" />}
                  {!stopMutation.isPending && <StopIcon className="size-3.5" aria-hidden="true" />}
                  {t('integrations.connection.stop')}
                </Button>
              )}
            </div>
          </div>
          <TabsList className="mt-3 h-7 gap-1 px-0">
            <TabsTrigger value="config" className="h-6 px-2 text-[11px]">Configuration</TabsTrigger>
            <TabsTrigger value="bindings" className="h-6 px-2 text-[11px]">Channel Bindings</TabsTrigger>
            <TabsTrigger value="threads" className="h-6 px-2 text-[11px]">Threads</TabsTrigger>
            <TabsTrigger value="deliveries" className="h-6 px-2 text-[11px]">
              Deliveries
              {retryableDeliveriesQuery.data && retryableDeliveriesQuery.data.length > 0 && (
                <span className="ml-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[9px] text-white">
                  {retryableDeliveriesQuery.data.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="config" className="flex-1 px-4 py-4">
          <SettingsGroup label={t('integrations.page.title')}>
            <div className="space-y-4 p-4">
              <div className="space-y-2">
                <Label htmlFor="displayName" className="text-xs">{t('integrations.connection.displayName')}</Label>
                {isEditing ? (
                  <Input
                    id="displayName"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={t('integrations.connection.displayNamePlaceholder')}
                    className="h-8 text-xs"
                  />
                ) : (
                  <div className="h-8 rounded-md border border-border/60 bg-muted/20 px-3 py-1.5 text-xs text-foreground">
                    {displayName}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-xs">{t('integrations.connection.enabled')}</Label>
                  <p className="text-[11px] text-muted-foreground">{t('integrations.connection.enabledDescription')}</p>
                </div>
                {isEditing ? (
                  <Switch checked={enabled} onCheckedChange={setEnabled} />
                ) : (
                  <Switch checked={enabled} disabled />
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-xs">{t('integrations.connection.healthStatus')}</Label>
                <div className="flex items-center gap-2">
                  <StatusDot status={connection.healthStatus} pulse={connection.healthStatus === 'running'} />
                  <span className="text-xs text-foreground">{healthStatusLabel(connection.healthStatus, t)}</span>
                </div>
                {connection.healthMessage && (
                  <p className="text-[11px] text-muted-foreground">{connection.healthMessage}</p>
                )}
              </div>

              <div className="flex items-center justify-between gap-4 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsEditing(!isEditing)}
                  className="h-7 text-xs"
                >
                  {isEditing ? t('integrations.connection.save') : t('registry.action.edit')}
                </Button>
                {isEditing && (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCancel}
                      className="h-7 text-xs"
                      disabled={updateMutation.isPending}
                    >
                      {t('registry.action.cancel')}
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSave}
                      className="h-7 text-xs"
                      disabled={updateMutation.isPending}
                    >
                      {updateMutation.isPending && <Spinner className="size-3.5 mr-1" />}
                      {t('integrations.connection.save')}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </SettingsGroup>

          {isSlack && (
            <SettingsGroup label={t('integrations.slack.title')} className="mt-6">
              <div className="space-y-2 p-4">
                <p className="text-[11px] text-muted-foreground">{t('integrations.slack.description')}</p>
                <p className="mt-2 text-[11px] text-muted-foreground/80">
                  Slack configuration is managed via secrets. Edit the connection to update credentials.
                </p>
              </div>
            </SettingsGroup>
          )}

          <SettingsGroup label={t('integrations.connection.healthStatus')} className="mt-6">
            <div className="grid gap-3 p-4 text-xs text-muted-foreground">
              <div className="flex items-center justify-between py-1">
                <span>{t('integrations.connection.createdAt')}</span>
                <span className="text-foreground">{formatTimestamp(connection.createdAt)}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span>{t('integrations.connection.updatedAt')}</span>
                <span className="text-foreground">{formatTimestamp(connection.updatedAt)}</span>
              </div>
              {connection.lastStartedAt && (
                <div className="flex items-center justify-between py-1">
                  <span>{t('integrations.connection.lastStartedAt')}</span>
                  <span className="text-foreground">{formatTimestamp(connection.lastStartedAt)}</span>
                </div>
              )}
              {connection.lastStoppedAt && (
                <div className="flex items-center justify-between py-1">
                  <span>{t('integrations.connection.lastStoppedAt')}</span>
                  <span className="text-foreground">{formatTimestamp(connection.lastStoppedAt)}</span>
                </div>
              )}
              {connection.lastErrorAt && (
                <div className="flex items-center justify-between py-1">
                  <span>{t('integrations.connection.lastErrorAt')}</span>
                  <span className="text-destructive">{formatTimestamp(connection.lastErrorAt)}</span>
                </div>
              )}
            </div>
          </SettingsGroup>
        </TabsContent>

        <TabsContent value="bindings" className="flex-1 px-4 py-4">
          <ChannelBindingsSection
            connectionId={connection.id}
            bindings={channelBindingsQuery.data ?? []}
            loading={channelBindingsQuery.isLoading}
            onUpdated={invalidateBindings}
          />
        </TabsContent>

        <TabsContent value="threads" className="flex-1 px-4 py-4">
          <ThreadsSection
            threads={threadsQuery.data ?? []}
            loading={threadsQuery.isLoading}
          />
        </TabsContent>

        <TabsContent value="deliveries" className="flex-1 px-4 py-4">
          <FailedDeliveriesSection
            connectionId={connection.id}
            deliveries={retryableDeliveriesQuery.data ?? []}
            loading={retryableDeliveriesQuery.isLoading}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// Channel bindings section
function ChannelBindingsSection({
  connectionId,
  bindings,
  loading,
  onUpdated,
}: {
  connectionId: string
  bindings: ChannelBinding[]
  loading: boolean
  onUpdated: () => void
}) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const { workspaces } = useWorkspaces()

  const [showAddDialog, setShowAddDialog] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: async (binding: ChannelBinding) => {
      const { error } = await deleteConversationBridgeConnectionsByIdWorkspacesByExternalWorkspaceIdChannelsByExternalChannelIdBinding({
        path: {
          id: connectionId,
          externalWorkspaceId: binding.externalWorkspaceId,
          externalChannelId: binding.externalChannelId,
        },
      })
      if (error) throw new Error(String(error))
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('integrations.channelBindings.toast.removed') })
      void onUpdated()
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('integrations.channelBindings.toast.removeFailed') })
    },
  })

  const handleRemoveBinding = (binding: ChannelBinding) => {
    void deleteMutation.mutate(binding)
  }

  const handleBindingAdded = () => {
    setShowAddDialog(false)
    void onUpdated()
  }

  return (
    <div className="space-y-4">
      <SettingsHeader
        title={t('integrations.channelBindings.title')}
        description={t('integrations.channelBindings.description')}
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAddDialog(true)}
            className="h-7 gap-1.5 text-xs"
          >
            <AddIcon className="size-3.5" aria-hidden="true" />
            {t('integrations.channelBindings.add')}
          </Button>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
          <Spinner className="size-3.5" />
        </div>
      ) : bindings.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-foreground/10 bg-muted/20 px-4 py-8 text-center">
          <LinksIcon className="mx-auto size-6 text-muted-foreground/40" aria-hidden="true" />
          <p className="mt-3 text-xs text-muted-foreground">{t('integrations.channelBindings.empty')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {bindings.map(binding => (
            <div key={binding.id} className="flex items-center justify-between rounded-xl border border-border/60 bg-card px-3 py-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{binding.externalChannelId}</span>
                  <span className="text-[11px] text-muted-foreground">in</span>
                  <span className="text-xs text-foreground">{binding.externalWorkspaceId}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Workspace: {workspaces.find(w => w.id === binding.cradleWorkspaceId)?.name ?? binding.cradleWorkspaceId}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => handleRemoveBinding(binding)}
                disabled={deleteMutation.isPending}
              >
                <TrashIcon className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <AddChannelBindingDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        connectionId={connectionId}
        onAdded={handleBindingAdded}
      />
    </div>
  )
}

// Add channel binding dialog
function AddChannelBindingDialog({
  open,
  onOpenChange,
  connectionId,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  onAdded: () => void
}) {
  const { t } = useTranslation('settings')
  const { workspaces } = useWorkspaces()

  const [externalWorkspaceId, setExternalWorkspaceId] = useState('')
  const [externalChannelId, setExternalChannelId] = useState('')
  const [cradleWorkspaceId, setCradleWorkspaceId] = useState('')

  const addMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await putConversationBridgeConnectionsByIdWorkspacesByExternalWorkspaceIdChannelsByExternalChannelIdBinding({
        path: { id: connectionId, externalWorkspaceId, externalChannelId },
        body: { cradleWorkspaceId },
      })
      if (error) throw new Error(String(error))
      return data
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('integrations.channelBindings.toast.added') })
      onAdded()
      setExternalWorkspaceId('')
      setExternalChannelId('')
      setCradleWorkspaceId('')
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('integrations.channelBindings.toast.addFailed') })
    },
  })

  const handleAdd = () => {
    void addMutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('integrations.channelBindings.add')}</DialogTitle>
          <DialogDescription>{t('integrations.channelBindings.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="externalWorkspaceId" className="text-xs">
              {t('integrations.channelBindings.externalWorkspaceId')}
            </Label>
            <Input
              id="externalWorkspaceId"
              value={externalWorkspaceId}
              onChange={(e) => setExternalWorkspaceId(e.target.value)}
              placeholder={t('integrations.channelBindings.externalWorkspaceIdPlaceholder')}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="externalChannelId" className="text-xs">
              {t('integrations.channelBindings.externalChannelId')}
            </Label>
            <Input
              id="externalChannelId"
              value={externalChannelId}
              onChange={(e) => setExternalChannelId(e.target.value)}
              placeholder={t('integrations.channelBindings.externalChannelIdPlaceholder')}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cradleWorkspaceId" className="text-xs">
              {t('integrations.channelBindings.cradleWorkspaceId')}
            </Label>
            <Select value={cradleWorkspaceId} onValueChange={setCradleWorkspaceId}>
              <SelectTrigger id="cradleWorkspaceId" className="h-8 text-xs">
                <SelectValue placeholder={t('integrations.channelBindings.cradleWorkspacePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map(workspace => (
                  <SelectItem key={workspace.id} value={workspace.id} className="text-xs">
                    {workspace.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-7 text-xs"
          >
            {t('registry.action.cancel')}
          </Button>
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={!externalWorkspaceId || !externalChannelId || !cradleWorkspaceId || addMutation.isPending}
            className="h-7 text-xs"
          >
            {addMutation.isPending && <Spinner className="size-3.5 mr-1" />}
            {t('integrations.channelBindings.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Threads section
function ThreadsSection({
  threads,
  loading,
}: {
  threads: ThreadBinding[]
  loading: boolean
}) {
  const { t } = useTranslation('settings')

  return (
    <div className="space-y-4">
      <SettingsHeader
        title={t('integrations.threads.title')}
        description={t('integrations.threads.description')}
      />

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
          <Spinner className="size-3.5" />
        </div>
      ) : threads.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-foreground/10 bg-muted/20 px-4 py-8 text-center">
          <LinkIcon className="mx-auto size-6 text-muted-foreground/40" aria-hidden="true" />
          <p className="mt-3 text-xs text-muted-foreground">{t('integrations.threads.empty')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map(thread => (
            <div key={thread.id} className="flex items-center justify-between rounded-xl border border-border/60 bg-card px-3 py-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{thread.externalThreadId}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Session: {thread.sessionId}
                </p>
              </div>
              <span className="text-[11px] text-muted-foreground">{timeAgo(thread.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Failed deliveries section
function FailedDeliveriesSection({
  deliveries,
  loading,
}: {
  connectionId: string
  deliveries: DeliveryAttempt[]
  loading: boolean
}) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()

  const retryMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await postConversationBridgeDeliveryAttemptsRetry()
      if (error) throw new Error(String(error))
      return data
    },
    onSuccess: (result) => {
      toastManager.add({
        type: 'success',
        title: t('integrations.delivery.toast.retried', {
          attempted: result?.attempted ?? 0,
          delivered: result?.delivered ?? 0,
          failed: result?.failed ?? 0,
        }),
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.retryableDeliveries })
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('integrations.delivery.toast.retryFailed') })
    },
  })

  const handleRetryAll = () => {
    void retryMutation.mutate()
  }

  return (
    <div className="space-y-4">
      <SettingsHeader
        title={t('integrations.delivery.title')}
        description={t('integrations.delivery.description')}
        action={
          deliveries.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRetryAll}
              disabled={retryMutation.isPending}
              className="h-7 gap-1.5 text-xs"
            >
              {retryMutation.isPending && <Spinner className="size-3.5" />}
              {!retryMutation.isPending && <RefreshIcon className="size-3.5" aria-hidden="true" />}
              {t('integrations.delivery.retryAll')}
            </Button>
          )
        }
      />

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
          <Spinner className="size-3.5" />
        </div>
      ) : deliveries.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-foreground/10 bg-muted/20 px-4 py-8 text-center">
          <RefreshIcon className="mx-auto size-6 text-muted-foreground/40" aria-hidden="true" />
          <p className="mt-3 text-xs text-muted-foreground">{t('integrations.delivery.empty')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {deliveries.map(delivery => (
            <div key={delivery.id} className="rounded-xl border border-border/60 bg-card px-3 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{delivery.status}</Badge>
                  <span className="text-xs font-medium text-foreground">{delivery.externalThreadId}</span>
                </div>
                <span className="text-[11px] text-muted-foreground">{timeAgo(delivery.createdAt)}</span>
              </div>
              <div className="mt-2 flex items-center gap-4 text-[11px] text-muted-foreground">
                <span>{t('integrations.delivery.attemptCount')}: {delivery.attemptCount}</span>
                {delivery.errorText && (
                  <span className="text-destructive">{t('integrations.delivery.errorText')}: {delivery.errorText}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Retry deliveries dialog
function RetryDeliveriesDialog({
  open,
  onOpenChange,
  onRetried,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onRetried: () => void
}) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()

  const retryMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await postConversationBridgeDeliveryAttemptsRetry()
      if (error) throw new Error(String(error))
      return data
    },
    onSuccess: (result) => {
      toastManager.add({
        type: 'success',
        title: t('integrations.delivery.toast.retried', {
          attempted: result?.attempted ?? 0,
          delivered: result?.delivered ?? 0,
          failed: result?.failed ?? 0,
        }),
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.retryableDeliveries })
      onRetried()
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('integrations.delivery.toast.retryFailed') })
    },
  })

  const handleRetry = () => {
    void retryMutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('integrations.delivery.retry')}</DialogTitle>
          <DialogDescription>{t('integrations.delivery.description')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-7 text-xs"
          >
            {t('registry.action.cancel')}
          </Button>
          <Button
            size="sm"
            onClick={handleRetry}
            disabled={retryMutation.isPending}
            className="h-7 text-xs"
          >
            {retryMutation.isPending && <Spinner className="size-3.5 mr-1" />}
            {t('integrations.delivery.retryAll')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Create connection dialog
function CreateConnectionDialog({
  open,
  onOpenChange,
  adapters,
  secrets,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  adapters: Adapter[]
  secrets: Secret[]
  onCreated: () => void
}) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()

  const [selectedAdapterId, setSelectedAdapterId] = useState<string>('')
  const [displayName, setDisplayName] = useState('')
  const [enabled, setEnabled] = useState(true)

  // Slack specific
  const [botTokenMode, setBotTokenMode] = useState<'select' | 'create'>('create')
  const [selectedBotTokenSecretId, setSelectedBotTokenSecretId] = useState('')
  const [newBotToken, setNewBotToken] = useState('')
  const [newBotTokenLabel, setNewBotTokenLabel] = useState('')

  const [appTokenMode, setAppTokenMode] = useState<'select' | 'create'>('create')
  const [selectedAppTokenSecretId, setSelectedAppTokenSecretId] = useState('')
  const [newAppToken, setNewAppToken] = useState('')
  const [newAppTokenLabel, setNewAppTokenLabel] = useState('')

  const [signingSecretMode, setSigningSecretMode] = useState<'select' | 'create'>('create')
  const [selectedSigningSecretSecretId, setSelectedSigningSecretSecretId] = useState('')
  const [newSigningSecret, setNewSigningSecret] = useState('')
  const [newSigningSecretLabel, setNewSigningSecretLabel] = useState('')

  const [logLevel, setLogLevel] = useState<'debug' | 'info' | 'warn' | 'error'>('info')

  const [creatingSecrets, setCreatingSecrets] = useState(false)
  const [createdSecretIds, setCreatedSecretIds] = useState<Record<string, string>>({})

  const selectedAdapter = useMemo(
    () => adapters.find(a => a.id === selectedAdapterId),
    [adapters, selectedAdapterId]
  )

  const isSlack = selectedAdapter?.platform === 'slack'

  const resetForm = () => {
    setSelectedAdapterId('')
    setDisplayName('')
    setEnabled(true)
    setBotTokenMode('create')
    setSelectedBotTokenSecretId('')
    setNewBotToken('')
    setNewBotTokenLabel('')
    setAppTokenMode('create')
    setSelectedAppTokenSecretId('')
    setNewAppToken('')
    setNewAppTokenLabel('')
    setSigningSecretMode('create')
    setSelectedSigningSecretSecretId('')
    setNewSigningSecret('')
    setNewSigningSecretLabel('')
    setLogLevel('info')
    setCreatingSecrets(false)
    setCreatedSecretIds({})
  }

  const createSecrets = async (): Promise<Record<string, string>> => {
    const ids: Record<string, string> = {}

    if (isSlack) {
      // Bot token
      if (botTokenMode === 'create' && newBotToken && newBotTokenLabel) {
        const { data } = await postSecrets({
          body: { kind: 'slack-bot-token', label: newBotTokenLabel, secret: newBotToken },
        })
        if (data?.id) ids.botToken = data.id
      } else if (botTokenMode === 'select' && selectedBotTokenSecretId) {
        ids.botToken = selectedBotTokenSecretId
      }

      // App token
      if (appTokenMode === 'create' && newAppToken && newAppTokenLabel) {
        const { data } = await postSecrets({
          body: { kind: 'slack-app-token', label: newAppTokenLabel, secret: newAppToken },
        })
        if (data?.id) ids.appToken = data.id
      } else if (appTokenMode === 'select' && selectedAppTokenSecretId) {
        ids.appToken = selectedAppTokenSecretId
      }

      // Signing secret
      if (signingSecretMode === 'create' && newSigningSecret && newSigningSecretLabel) {
        const { data } = await postSecrets({
          body: { kind: 'slack-signing-secret', label: newSigningSecretLabel, secret: newSigningSecret },
        })
        if (data?.id) ids.signingSecret = data.id
      } else if (signingSecretMode === 'select' && selectedSigningSecretSecretId) {
        ids.signingSecret = selectedSigningSecretSecretId
      }
    }

    return ids
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAdapter) throw new Error('No adapter selected')

      const secretRefs: Record<string, string> = {}
      const config: Record<string, any> = {}

      if (isSlack) {
        // Use created or selected secrets
        if (createdSecretIds.botToken) secretRefs.botToken = createdSecretIds.botToken
        if (createdSecretIds.appToken) secretRefs.appToken = createdSecretIds.appToken
        if (createdSecretIds.signingSecret) secretRefs.signingSecret = createdSecretIds.signingSecret
        config.logLevel = logLevel
      }

      const { data, error } = await postConversationBridgeConnections({
        body: {
          platform: selectedAdapter.platform,
          adapterOwner: selectedAdapter.owner,
          adapterId: selectedAdapter.id,
          displayName,
          enabled,
          secretRefs: Object.keys(secretRefs).length > 0 ? secretRefs : undefined,
          config: Object.keys(config).length > 0 ? config : undefined,
        },
      })
      if (error) throw new Error(String(error))
      return data
    },
    onSuccess: () => {
      toastManager.add({ type: 'success', title: t('integrations.connection.toast.created') })
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections })
      void queryClient.invalidateQueries({ queryKey: queryKeys.secrets })
      resetForm()
      onCreated()
    },
    onError: () => {
      toastManager.add({ type: 'error', title: t('integrations.connection.toast.createFailed') })
      setCreatingSecrets(false)
    },
  })

  const handleCreate = async () => {
    if (!selectedAdapter) return

    setCreatingSecrets(true)
    try {
      const ids = await createSecrets()
      setCreatedSecretIds(ids)
      void createMutation.mutate()
    } catch (e) {
      toastManager.add({ type: 'error', title: t('integrations.connection.toast.createFailed') })
      setCreatingSecrets(false)
    }
  }

  const isSlackFormValid = isSlack && (
    ((botTokenMode === 'create' && newBotToken && newBotTokenLabel) || (botTokenMode === 'select' && selectedBotTokenSecretId)) &&
    ((appTokenMode === 'create' && newAppToken && newAppTokenLabel) || (appTokenMode === 'select' && selectedAppTokenSecretId)) &&
    ((signingSecretMode === 'create' && newSigningSecret && newSigningSecretLabel) || (signingSecretMode === 'select' && selectedSigningSecretSecretId))
  )

  const isFormValid = selectedAdapter && displayName && (isSlack ? isSlackFormValid : true)

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) resetForm()
        onOpenChange(open)
      }}
    >
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('integrations.connection.create')}</DialogTitle>
          <DialogDescription>Configure a new connection for an integration adapter.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Adapter selection */}
          <div className="space-y-2">
            <Label htmlFor="adapter" className="text-xs">{t('integrations.connection.adapter')}</Label>
            <Select value={selectedAdapterId} onValueChange={setSelectedAdapterId}>
              <SelectTrigger id="adapter" className="h-8 text-xs">
                <SelectValue placeholder="Select an adapter" />
              </SelectTrigger>
              <SelectContent>
                {adapters.map(adapter => (
                  <SelectItem key={`${adapter.owner}-${adapter.id}`} value={adapter.id} className="text-xs">
                    {adapter.label} ({adapter.platform})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Display name */}
          <div className="space-y-2">
            <Label htmlFor="displayName" className="text-xs">{t('integrations.connection.displayName')}</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t('integrations.connection.displayNamePlaceholder')}
              className="h-8 text-xs"
            />
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-xs">{t('integrations.connection.enabled')}</Label>
              <p className="text-[11px] text-muted-foreground">{t('integrations.connection.enabledDescription')}</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {/* Slack specific configuration */}
          {isSlack && (
            <div className="space-y-4 rounded-xl border border-border/60 bg-muted/20 p-4">
              <h3 className="text-xs font-medium text-foreground">{t('integrations.slack.title')}</h3>
              <p className="text-[11px] text-muted-foreground">{t('integrations.slack.description')}</p>

              {/* Bot token */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t('integrations.slack.botToken')}</Label>
                  <div className="flex items-center gap-2 text-[11px]">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <Checkbox
                        checked={botTokenMode === 'select'}
                        onCheckedChange={() => setBotTokenMode('select')}
                      />
                      {t('integrations.slack.secret.selectExisting')}
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <Checkbox
                        checked={botTokenMode === 'create'}
                        onCheckedChange={() => setBotTokenMode('create')}
                      />
                      {t('integrations.slack.secret.createNew')}
                    </label>
                  </div>
                </div>
                {botTokenMode === 'select' ? (
                  <Select value={selectedBotTokenSecretId} onValueChange={setSelectedBotTokenSecretId}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select a secret" />
                    </SelectTrigger>
                    <SelectContent>
                      {secrets.map(secret => (
                        <SelectItem key={secret.id} value={secret.id} className="text-xs">
                          {secret.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <>
                    <Input
                      value={newBotTokenLabel}
                      onChange={(e) => setNewBotTokenLabel(e.target.value)}
                      placeholder={t('integrations.slack.secret.labelPlaceholder')}
                      className="h-8 text-xs"
                    />
                    <Input
                      value={newBotToken}
                      onChange={(e) => setNewBotToken(e.target.value)}
                      placeholder={t('integrations.slack.botTokenPlaceholder')}
                      type="password"
                      className="h-8 text-xs"
                    />
                  </>
                )}
                <p className="text-[11px] text-muted-foreground">{t('integrations.slack.botTokenDescription')}</p>
              </div>

              {/* App token */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t('integrations.slack.appToken')}</Label>
                  <div className="flex items-center gap-2 text-[11px]">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <Checkbox
                        checked={appTokenMode === 'select'}
                        onCheckedChange={() => setAppTokenMode('select')}
                      />
                      {t('integrations.slack.secret.selectExisting')}
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <Checkbox
                        checked={appTokenMode === 'create'}
                        onCheckedChange={() => setAppTokenMode('create')}
                      />
                      {t('integrations.slack.secret.createNew')}
                    </label>
                  </div>
                </div>
                {appTokenMode === 'select' ? (
                  <Select value={selectedAppTokenSecretId} onValueChange={setSelectedAppTokenSecretId}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select a secret" />
                    </SelectTrigger>
                    <SelectContent>
                      {secrets.map(secret => (
                        <SelectItem key={secret.id} value={secret.id} className="text-xs">
                          {secret.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <>
                    <Input
                      value={newAppTokenLabel}
                      onChange={(e) => setNewAppTokenLabel(e.target.value)}
                      placeholder={t('integrations.slack.secret.labelPlaceholder')}
                      className="h-8 text-xs"
                    />
                    <Input
                      value={newAppToken}
                      onChange={(e) => setNewAppToken(e.target.value)}
                      placeholder={t('integrations.slack.appTokenPlaceholder')}
                      type="password"
                      className="h-8 text-xs"
                    />
                  </>
                )}
                <p className="text-[11px] text-muted-foreground">{t('integrations.slack.appTokenDescription')}</p>
              </div>

              {/* Signing secret */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">{t('integrations.slack.signingSecret')}</Label>
                  <div className="flex items-center gap-2 text-[11px]">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <Checkbox
                        checked={signingSecretMode === 'select'}
                        onCheckedChange={() => setSigningSecretMode('select')}
                      />
                      {t('integrations.slack.secret.selectExisting')}
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <Checkbox
                        checked={signingSecretMode === 'create'}
                        onCheckedChange={() => setSigningSecretMode('create')}
                      />
                      {t('integrations.slack.secret.createNew')}
                    </label>
                  </div>
                </div>
                {signingSecretMode === 'select' ? (
                  <Select value={selectedSigningSecretSecretId} onValueChange={setSelectedSigningSecretSecretId}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select a secret" />
                    </SelectTrigger>
                    <SelectContent>
                      {secrets.map(secret => (
                        <SelectItem key={secret.id} value={secret.id} className="text-xs">
                          {secret.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <>
                    <Input
                      value={newSigningSecretLabel}
                      onChange={(e) => setNewSigningSecretLabel(e.target.value)}
                      placeholder={t('integrations.slack.secret.labelPlaceholder')}
                      className="h-8 text-xs"
                    />
                    <Input
                      value={newSigningSecret}
                      onChange={(e) => setNewSigningSecret(e.target.value)}
                      placeholder={t('integrations.slack.signingSecretPlaceholder')}
                      type="password"
                      className="h-8 text-xs"
                    />
                  </>
                )}
                <p className="text-[11px] text-muted-foreground">{t('integrations.slack.signingSecretDescription')}</p>
              </div>

              {/* Log level */}
              <div className="space-y-2">
                <Label htmlFor="logLevel" className="text-xs">{t('integrations.slack.logLevel')}</Label>
                <Select value={logLevel} onValueChange={(v: any) => setLogLevel(v)}>
                  <SelectTrigger id="logLevel" className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="debug" className="text-xs">{t('integrations.slack.logLevelDebug')}</SelectItem>
                    <SelectItem value="info" className="text-xs">{t('integrations.slack.logLevelInfo')}</SelectItem>
                    <SelectItem value="warn" className="text-xs">{t('integrations.slack.logLevelWarn')}</SelectItem>
                    <SelectItem value="error" className="text-xs">{t('integrations.slack.logLevelError')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-7 text-xs"
          >
            {t('registry.action.cancel')}
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={!isFormValid || createMutation.isPending || creatingSecrets}
            className="h-7 text-xs"
          >
            {(createMutation.isPending || creatingSecrets) && <Spinner className="size-3.5 mr-1" />}
            {t('integrations.connection.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Main component - Landing page with categories
export function IntegrationsSettings() {
  const { t } = useTranslation('settings')
  const { prefs, isLoading: prefsLoading, savePrefs, isSaving } = useAppPreferences()
  const queryClient = useQueryClient()

  // Queries for status badges
  const adaptersQuery = useQuery({
    queryKey: queryKeys.adapters,
    queryFn: async () => {
      const { data, error } = await getConversationBridgeAdapters()
      if (error) throw new Error(String(error))
      return data ?? []
    },
  })

  const connectionsQuery = useQuery({
    queryKey: queryKeys.connections,
    queryFn: async () => {
      const { data, error } = await getConversationBridgeConnections()
      if (error) throw new Error(String(error))
      return data ?? []
    },
  })

  // State for active view
  const [activeView, setActiveView] = useState<'landing' | 'connections' | 'provider'>('landing')
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showRetryDialog, setShowRetryDialog] = useState(false)
  const [deletingConnectionId, setDeletingConnectionId] = useState<string | null>(null)

  // Derived state
  const adapters = useMemo(() => adaptersQuery.data ?? [], [adaptersQuery.data])
  const connections = useMemo(() => connectionsQuery.data ?? [], [connectionsQuery.data])

  const connectedCount = connections.filter(c => c.healthStatus === 'running').length
  const errorCount = connections.filter(c => c.healthStatus === 'error').length

  // Save feature flags helper
  const saveFeatureFlags = (featureFlags: Partial<typeof prefs.featureFlags>) => {
    if (!prefs) {
      return
    }

    void savePrefs({
      featureFlags: {
        ...prefs.featureFlags,
        ...featureFlags,
      },
    })
  }

  // Back to landing
  const goToLanding = () => {
    setActiveView('landing')
    setSelectedConnectionId(null)
  }

  // If showing connections detail view
  if (activeView === 'connections') {
    return (
      <ConnectionsView
        onBack={goToLanding}
        selectedConnectionId={selectedConnectionId}
        onSelectConnection={setSelectedConnectionId}
        showCreateDialog={showCreateDialog}
        setShowCreateDialog={setShowCreateDialog}
        showRetryDialog={showRetryDialog}
        setShowRetryDialog={setShowRetryDialog}
        deletingConnectionId={deletingConnectionId}
        setDeletingConnectionId={setDeletingConnectionId}
      />
    )
  }

  // If showing provider integration settings
  if (activeView === 'provider') {
    return (
      <ProviderIntegrationView
        onBack={goToLanding}
        prefs={prefs}
        prefsLoading={prefsLoading}
        isSaving={isSaving}
        saveFeatureFlags={saveFeatureFlags}
      />
    )
  }

  // Landing page
  return (
    <SettingsPage
      title={t('integrations.page.title')}
      description={t('integrations.page.description')}
      maxWidth="3xl"
    >
      <div className="space-y-8">
        {/* Integration Categories */}
        <div className="space-y-3">
          <div className="px-1">
            <h2 className="text-xs font-medium text-muted-foreground">{t('integrations.categories.label')}</h2>
          </div>
          <div className="grid gap-3">
            <IntegrationCard
              icon={LinkIcon}
              title={t('integrations.categories.connections.title')}
              description={t('integrations.categories.connections.description')}
              badge={connections.length > 0 ? `${connectedCount}/${connections.length}` : undefined}
              color="blue"
              onClick={() => setActiveView('connections')}
            />
            <IntegrationCard
              icon={CodeIcon}
              title={t('integrations.categories.provider.title')}
              description={t('integrations.categories.provider.description')}
              badge={prefs?.featureFlags.nativeProviderSkillProjection ? 'Enabled' : undefined}
              color="purple"
              onClick={() => setActiveView('provider')}
            />
          </div>
        </div>

        {/* Quick Stats */}
        <div className="space-y-3">
          <div className="px-1">
            <h2 className="text-xs font-medium text-muted-foreground">{t('integrations.overview.label')}</h2>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Card className="border-border/60 bg-card">
              <CardHeader className="py-3">
                <div className="flex items-center gap-2">
                  <BridgeIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                  <CardTitle className="text-[11px] font-medium text-muted-foreground">{t('integrations.overview.adapters')}</CardTitle>
                </div>
                <div className="mt-1 text-lg font-semibold text-foreground">
                  {adaptersQuery.isLoading ? '...' : adapters.length}
                </div>
              </CardHeader>
            </Card>
            <Card className="border-border/60 bg-card">
              <CardHeader className="py-3">
                <div className="flex items-center gap-2">
                  <PuzzleIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                  <CardTitle className="text-[11px] font-medium text-muted-foreground">{t('integrations.overview.connections')}</CardTitle>
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-lg font-semibold text-foreground">
                    {connectionsQuery.isLoading ? '...' : connections.length}
                  </span>
                  {connectedCount > 0 && (
                    <span className="text-[11px] text-success">
                      {connectedCount} running
                    </span>
                  )}
                </div>
              </CardHeader>
            </Card>
          </div>
        </div>
      </div>
    </SettingsPage>
  )
}
