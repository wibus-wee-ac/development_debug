// Chat settings for default continuation behavior and archived session recovery.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArchiveRestoreIcon, MessageSquareIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { getSessionsByIdQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { postSessionsByIdArchive } from '~/api-gen/sdk.gen'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { toastManager } from '~/components/ui/toast'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { cn } from '~/lib/cn'

import { sessionsQueryKey, type WorkspaceSession, useAllSessions } from '../workspace/use-session'

import { SettingsDivider, SettingsRow, SettingsSectionHeader } from './settings-row'
import type { ContinuationBehavior } from './use-chat-preferences'
import { useChatPreferences } from './use-chat-preferences'

type SettingsKey = keyof typeof import('~/locales/default').default.settings

function formatArchivedAt(session: WorkspaceSession): string {
  const timestamp = session.archivedAt ?? session.updatedAt
  return new Date(timestamp * 1000).toLocaleString()
}

function normalizeArchivedSession(session: {
  id: string
  workspaceId: string | unknown | null
  title: string | unknown | null
  providerTargetId: string | unknown | null
  agentId: string | unknown | null
  modelId: string | unknown | null
  linkedIssueId: string | unknown | null
  runtimeKind: WorkspaceSession['runtimeKind']
  status: WorkspaceSession['status']
  pinned: number
  archivedAt: number | unknown | null
  createdAt: number
  updatedAt: number
  latestUserMessageAt: number | unknown | null
}): WorkspaceSession {
  const latestUserMessageAt = typeof session.latestUserMessageAt === 'number' ? session.latestUserMessageAt : null
  return {
    id: session.id,
    workspaceId: typeof session.workspaceId === 'string' ? session.workspaceId : null,
    title: typeof session.title === 'string' ? session.title : null,
    providerTargetId: typeof session.providerTargetId === 'string' ? session.providerTargetId : null,
    agentId: typeof session.agentId === 'string' ? session.agentId : null,
    modelId: typeof session.modelId === 'string' ? session.modelId : null,
    linkedIssueId: typeof session.linkedIssueId === 'string' ? session.linkedIssueId : null,
    runtimeKind: session.runtimeKind,
    status: session.status,
    pinned: session.pinned,
    archivedAt: typeof session.archivedAt === 'number' ? session.archivedAt : null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    latestUserMessageAt,
    listActivityAt: latestUserMessageAt ?? session.createdAt,
  }
}

function ArchivedSessionRow({
  session,
  restoring,
  onRestore,
}: {
  session: WorkspaceSession
  restoring: boolean
  onRestore: (session: WorkspaceSession) => void
}) {
  const { t } = useTranslation('settings')
  const title = session.title?.trim() || t('chat.archive.untitled' as SettingsKey)
  const meta = session.workspaceId
    ? `${t('chat.archive.metaLabel' as SettingsKey)} ${formatArchivedAt(session)} · ${session.workspaceId}`
    : `${t('chat.archive.metaLabel' as SettingsKey)} ${formatArchivedAt(session)}`

  return (
    <div className="group flex min-w-0 items-center gap-2.5 rounded-md border border-border/50 bg-muted/20 px-3 py-2 transition-colors hover:bg-muted/30">
      <MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-medium text-foreground/90">{title}</div>
        <div className="truncate text-[10.5px] tabular-nums text-muted-foreground/65">{meta}</div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={restoring}
        onClick={() => onRestore(session)}
        aria-label={`${t('chat.archive.restore' as SettingsKey)} ${title}`}
      >
        {restoring
          ? <Spinner className="size-3" />
          : <ArchiveRestoreIcon className="size-3" aria-hidden="true" />}
        {t('chat.archive.restore' as SettingsKey)}
      </Button>
    </div>
  )
}

function ArchivedSessionList() {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const { sessions, loading } = useAllSessions(true)
  const sortedSessions = sessions.toSorted((a, b) => (b.archivedAt ?? b.updatedAt) - (a.archivedAt ?? a.updatedAt))
  const restoreSession = useMutation({
    mutationFn: async (sessionId: string) => {
      const { data } = await postSessionsByIdArchive({
        path: { id: sessionId },
        body: { archived: false },
        throwOnError: true,
      })
      return normalizeArchivedSession(data as Parameters<typeof normalizeArchivedSession>[0])
    },
    onSuccess: async (session) => {
      toastManager.add({ type: 'success', title: t('chat.archive.restored' as SettingsKey) })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey(undefined, true) }),
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey(session.workspaceId ?? null) }),
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey(session.workspaceId ?? null, true) }),
        queryClient.invalidateQueries({ queryKey: getSessionsByIdQueryKey({ path: { id: session.id } }) }),
      ])
    },
    onError: (error) => {
      toastManager.add({
        type: 'error',
        title: t('chat.archive.restoreFailed' as SettingsKey),
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })

  return (
    <div className="flex flex-col gap-2 py-3" data-testid="chat-archived-sessions">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-foreground">{t('chat.archive.label' as SettingsKey)}</div>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{t('chat.archive.description' as SettingsKey)}</p>
        </div>
        <div className="shrink-0 rounded-full bg-muted/50 px-2 py-0.5 text-[10.5px] tabular-nums text-muted-foreground">
          {sortedSessions.length}
        </div>
      </div>

      {loading
        ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-foreground/10 bg-muted/20 px-4 py-5 text-[11px] text-muted-foreground/70">
            <Spinner className="size-3.5" />
            {t('chat.archive.loading' as SettingsKey)}
          </div>
        )
        : sortedSessions.length === 0
          ? (
            <div className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-foreground/10 bg-muted/20 px-4 py-5 text-center">
              <ArchiveRestoreIcon className="size-4 text-muted-foreground/40" aria-hidden="true" />
              <span className="text-[11px] text-muted-foreground/70">{t('chat.archive.empty' as SettingsKey)}</span>
            </div>
          )
          : (
            <div className={cn('flex flex-col gap-1.5', sortedSessions.length > 6 && 'max-h-80 overflow-y-auto pr-1')}>
              {sortedSessions.map(session => (
                <ArchivedSessionRow
                  key={session.id}
                  session={session}
                  restoring={restoreSession.isPending && restoreSession.variables === session.id}
                  onRestore={(target) => {
                    restoreSession.mutate(target.id)
                  }}
                />
              ))}
            </div>
          )}
    </div>
  )
}

export function ChatSettings() {
  const { t } = useTranslation('settings')
  const { prefs, isSaving, savePrefs } = useChatPreferences()

  if (!prefs) {
    return null
  }

  const handleBehaviorChange = (value: string) => {
    if (value !== 'queue' && value !== 'steer') {
      return
    }
    void savePrefs({ continuationBehavior: value as ContinuationBehavior })
  }

  return (
    <div className="flex flex-col gap-0" data-testid="chat-settings">
      <SettingsSectionHeader
        title={t('chat.page.title')}
        description={t('chat.page.description')}
      />
      <SettingsDivider />
      <ArchivedSessionList />
      <SettingsDivider />

      <SettingsRow
        label={t('chat.continuation.label')}
        description={t('chat.continuation.description')}
      >
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={prefs.continuationBehavior}
          onValueChange={handleBehaviorChange}
          disabled={isSaving}
          aria-label={t('chat.continuation.label')}
          data-testid="chat-continuation-behavior"
        >
          <ToggleGroupItem value="queue" aria-label={t('chat.continuation.queue')}>
            {t('chat.continuation.queue')}
          </ToggleGroupItem>
          <ToggleGroupItem value="steer" aria-label={t('chat.continuation.steer')}>
            {t('chat.continuation.steer')}
          </ToggleGroupItem>
        </ToggleGroup>
      </SettingsRow>
    </div>
  )
}
