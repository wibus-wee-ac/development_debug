import { useQueryClient } from '@tanstack/react-query'
import type { FileUIPart } from 'ai'
import type { TFunction } from 'i18next'
import {
  ClockIcon,
  FolderIcon,
  FolderPlusIcon,
  MessageSquareIcon,
} from 'lucide-react'
import { m } from 'motion/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { postSessions } from '~/api-gen/sdk.gen'
import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import { Button } from '~/components/ui/button'
import { DitheredGradientDecoration } from '~/components/ui/canvas-art'
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '~/components/ui/menu'
import type { DraftChatComposerSubmitOptions } from '~/features/chat/composer/draft-chat-composer'
import { DraftChatComposer } from '~/features/chat/composer/draft-chat-composer'
import type { ChatContextPart } from '~/features/chat/context/chat-context-parts'
import { startOptimisticChatResponse } from '~/features/chat/session/optimistic-chat-turn'
import { sessionsQueryKey, updateSessionInSessionLists, useWorkspaceSessions } from '~/features/workspace/use-session'
import { useAddWorkspace, useWorkspaces, WORKSPACES_QUERY_KEY } from '~/features/workspace/use-workspace'
import { useNow } from '~/hooks/use-now'
import { cn } from '~/lib/cn'
import { openChatSession } from '~/navigation/navigation-commands'
import { useSurfaceActive } from '~/navigation/surface-activity-context'
import { openTearoffSessionWindow } from '~/navigation/tearoff-sessions'
import { useNewChatStore } from '~/store/new-chat'
import { useSessionLayoutStore } from '~/store/session-layout'

/* ─── Constants ───────────────────────────────────────────────────────── */

const QUICK_ACTIONS = [
  { labelKey: 'quick.explain.label', promptKey: 'quick.explain.prompt' },
  { labelKey: 'quick.risk.label', promptKey: 'quick.risk.prompt' },
  { labelKey: 'quick.fixTest.label', promptKey: 'quick.fixTest.prompt' },
  { labelKey: 'quick.notes.label', promptKey: 'quick.notes.prompt' },
  { labelKey: 'quick.refactor.label', promptKey: 'quick.refactor.prompt' },
] as const

type NewChatTranslation = TFunction<'new-chat'>

/* ─── Helpers ─────────────────────────────────────────────────────────── */

function timeAgo(timestamp: number, now: number, t: NewChatTranslation): string {
  const seconds = Math.floor((now - timestamp) / 1000)
  if (seconds < 60) {
    return t('relative.justNow')
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return t('relative.minutesAgo', { count: minutes })
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return t('relative.hoursAgo', { count: hours })
  }
  const days = Math.floor(hours / 24)
  if (days < 30) {
    return t('relative.daysAgo', { count: days })
  }
  return t('relative.monthsAgo', { count: Math.floor(days / 30) })
}

/* ─── Owner Hook ──────────────────────────────────────────────────────── */

function useNewChatPageOwner(active: boolean) {
  const { t } = useTranslation('new-chat')
  const { workspaces, loading: workspacesLoading } = useWorkspaces()
  const { addFromPicker, adding: addingWorkspace } = useAddWorkspace()
  const queryClient = useQueryClient()

  const [draft, setDraft] = useState('')
  const [quickActionText, setQuickActionText] = useState<string | undefined>(undefined)
  const [quickActionKey, setQuickActionKey] = useState(0)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('cradle:lastWorkspaceId')
    }
    catch {
      return null
    }
  })

  useEffect(() => {
    try {
      if (selectedWorkspaceId) {
        localStorage.setItem('cradle:lastWorkspaceId', selectedWorkspaceId)
      }
      else {
        localStorage.removeItem('cradle:lastWorkspaceId')
      }
    }
    catch {}
  }, [selectedWorkspaceId])

  const selectedProjectWorkspaceId = useMemo(() => {
    if (selectedWorkspaceId && workspaces.some(w => w.id === selectedWorkspaceId)) {
      return selectedWorkspaceId
    }
    return null
  }, [selectedWorkspaceId, workspaces])

  const selectedWorkspace = workspaces.find(w => w.id === selectedProjectWorkspaceId) ?? null
  const { sessions, loading: sessionsLoading } = useWorkspaceSessions(selectedProjectWorkspaceId)
  const now = useNow(60_000, active)
  const sessionsReady = selectedProjectWorkspaceId === null || !sessionsLoading
  const isReady = !workspacesLoading
    && sessionsReady

  const recentSessions = useMemo(() => {
    return sessions.slice(0, 6)
  }, [sessions])

  const openCreatedChatSession = useCallback(async (sessionId: string, target: 'tab' | 'window') => {
    if (target === 'window') {
      const openedWindow = await openTearoffSessionWindow(sessionId)
      if (openedWindow) {
        return
      }
    }
    openChatSession(sessionId)
  }, [])

  const handleSendToTarget = useCallback(async (
    text: string,
    files: FileUIPart[],
    contextParts: ChatContextPart[] = [],
    options: DraftChatComposerSubmitOptions,
    target: 'tab' | 'window' = 'tab',
  ) => {
    const trimmedText = text.trim()
    try {
      if (options.runtimeKind === 'cli-tui') {
        if (!options.agentId) {
          return false
        }
        const { data: sessionData } = await postSessions({
          body: {
            ...(selectedProjectWorkspaceId ? { workspaceId: selectedProjectWorkspaceId } : {}),
            title: trimmedText.slice(0, 80) || options.agentName || options.agentId,
            agentId: options.agentId,
            runtimeSettings: options.runtimeSettings,
          },
        })
        const session = sessionData as { id: string, workspaceId: string | null } | null
        if (!session?.id) {
          return false
        }
        useSessionLayoutStore.getState().upsertSession({
          sessionId: session.id,
          sessionTitle: trimmedText.slice(0, 80) || options.agentName || options.agentId,
          workspaceId: session.workspaceId ?? selectedProjectWorkspaceId ?? null,
          workspacePath: selectedWorkspace?.id === selectedProjectWorkspaceId ? selectedWorkspace.path : null,
          runtimeKind: 'cli-tui',
        })
        updateSessionInSessionLists(queryClient, {
          id: session.id,
          title: trimmedText.slice(0, 80) || options.agentName || options.agentId,
          workspaceId: session.workspaceId ?? selectedProjectWorkspaceId ?? null,
          agentId: options.agentId,
          runtimeKind: 'cli-tui',
        }, { promote: true })
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: sessionsQueryKey(session.workspaceId ?? selectedProjectWorkspaceId) }),
          queryClient.invalidateQueries({ queryKey: sessionsQueryKey() }),
          queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
        ])
        await openCreatedChatSession(session.id, target)
        return true
      }

      if (!options.providerTargetId) {
        return false
      }
      const { data: sessionData } = await postSessions({
        body: {
          ...(selectedProjectWorkspaceId ? { workspaceId: selectedProjectWorkspaceId } : {}),
          title: trimmedText.slice(0, 80) || options.providerTargetName || options.providerTargetId,
          providerTargetId: options.providerTargetId,
          modelId: options.modelId ?? null,
          runtimeKind: options.runtimeKind,
          runtimeSettings: options.runtimeSettings,
        },
      })
      const session = sessionData as { id: string, workspaceId: string | null } | null
      if (!session?.id) {
        return false
      }
      useSessionLayoutStore.getState().upsertSession({
        sessionId: session.id,
        sessionTitle: trimmedText.slice(0, 80) || options.providerTargetName || options.providerTargetId,
        workspaceId: session.workspaceId ?? selectedProjectWorkspaceId ?? null,
        workspacePath: selectedWorkspace?.id === selectedProjectWorkspaceId ? selectedWorkspace.path : null,
        runtimeKind: options.runtimeKind,
      })
      updateSessionInSessionLists(queryClient, {
        id: session.id,
        title: trimmedText.slice(0, 80) || options.providerTargetName || options.providerTargetId,
        workspaceId: session.workspaceId ?? selectedProjectWorkspaceId ?? null,
        providerTargetId: options.providerTargetId,
        modelId: options.modelId ?? null,
        runtimeKind: options.runtimeKind,
      }, { promote: true })
      startOptimisticChatResponse({
        sessionId: session.id,
        runtimeKind: options.runtimeKind,
        queryClient,
        body: {
          text: trimmedText,
          files,
          contextParts,
          modelId: options.modelId,
          thinkingEffort: options.thinkingEffort,
          runtimeSettings: options.runtimeSettings,
        },
        onAccepted: () => {
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: sessionsQueryKey(session.workspaceId ?? selectedProjectWorkspaceId) }),
            queryClient.invalidateQueries({ queryKey: sessionsQueryKey() }),
          ])
        },
        onError: (err) => {
          console.error('[NewChatPage] start response failed:', err)
        },
      })
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey(session.workspaceId ?? selectedProjectWorkspaceId) }),
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
      ])
      await openCreatedChatSession(session.id, target)
      return true
    }
    catch (err) {
      console.error('[NewChatPage] send failed:', err)
      return false
    }
  }, [openCreatedChatSession, queryClient, selectedProjectWorkspaceId, selectedWorkspace?.id, selectedWorkspace?.path])

  const handleSend = useCallback((text: string, files: FileUIPart[], contextParts: ChatContextPart[], options: DraftChatComposerSubmitOptions) => {
    return handleSendToTarget(text, files, contextParts, options, 'tab')
  }, [handleSendToTarget])

  const handleSendInNewWindow = useCallback((text: string, files: FileUIPart[], contextParts: ChatContextPart[], options: DraftChatComposerSubmitOptions) => {
    return handleSendToTarget(text, files, contextParts, options, 'window')
  }, [handleSendToTarget])

  const handleQuickAction = useCallback((prompt: string) => {
    setQuickActionText(prompt)
    setQuickActionKey(key => key + 1)
  }, [])

  const handleResumeSession = useCallback((sessionId: string) => {
    openChatSession(sessionId)
  }, [])

  return {
    draft,
    handleQuickAction,
    handleResumeSession,
    handleSend,
    handleSendInNewWindow,
    isReady,
    now,
    recentSessions,
    selectedWorkspace,
    setDraft,
    addFromPicker,
    addingWorkspace,
    setSelectedWorkspaceId,
    t,
    quickActionKey,
    quickActionText,
    workspaces,
  }
}

/* ─── Composer Card ───────────────────────────────────────────────────── */

function NewChatComposerCard({
  active,
  owner,
}: {
  active: boolean
  owner: ReturnType<typeof useNewChatPageOwner>
}) {
  const {
    handleSend,
    handleSendInNewWindow,
    quickActionKey,
    quickActionText,
    addFromPicker,
    addingWorkspace,
    setSelectedWorkspaceId,
    setDraft,
    selectedWorkspace,
    t,
    workspaces,
  } = owner

  const workspaceSelector = (
    <Menu>
      <MenuTrigger render={<Button variant="ghost" size="xs" className="text-muted-foreground/35 hover:text-muted-foreground/60" />} data-testid="new-chat-workspace-selector">
        <FolderIcon className="size-3 shrink-0" />
        <span className="max-w-24 truncate">{selectedWorkspace?.name ?? t('workspace.adhoc')}</span>
      </MenuTrigger>
      <MenuPopup>
        <MenuGroup>
          <MenuGroupLabel>{t('workspace.group')}</MenuGroupLabel>
          <MenuSeparator />
          <MenuItem
            onClick={() => setSelectedWorkspaceId(null)}
            data-testid="new-chat-workspace-option-adhoc"
          >
            <MessageSquareIcon className="size-3" />
            <span className="flex-1">{t('workspace.adhoc')}</span>
          </MenuItem>
          {workspaces.map(workspace => (
            <MenuItem
              key={workspace.id}
              onClick={() => setSelectedWorkspaceId(workspace.id)}
              data-testid={`new-chat-workspace-option-${workspace.id}`}
            >
              <FolderIcon className="size-3" />
              <span className="flex-1">{workspace.name}</span>
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem
            onClick={() => void addFromPicker()}
            disabled={addingWorkspace}
            data-testid="new-chat-workspace-add-project"
          >
            <FolderPlusIcon className="size-3" />
            <span className="flex-1">{addingWorkspace ? t('workspace.adding') : t('workspace.addProject')}</span>
          </MenuItem>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  )

  return (
    <DraftChatComposer
      workspaceId={selectedWorkspace?.id ?? null}
      active={active}
      contextBar={workspaceSelector}
      replaceText={quickActionText}
      replaceTextKey={quickActionKey}
      onDraftChange={setDraft}
      onSend={handleSend}
      onSendInNewWindow={handleSendInNewWindow}
      testIdPrefix="new-chat"
    />
  )
}

/* ─── Quick Actions ───────────────────────────────────────────────────── */

function NewChatQuickActions({ owner }: { owner: ReturnType<typeof useNewChatPageOwner> }) {
  const { t } = useTranslation('new-chat')

  if (owner.draft.length > 0) {
    return null
  }

  return (
    <m.div
      className="mt-3 flex flex-wrap gap-1.5 px-1"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.15, duration: 0.22 }}
    >
      {QUICK_ACTIONS.map((action, index) => (
        <m.button
          key={action.labelKey}
          type="button"
          onClick={() => owner.handleQuickAction(t(action.promptKey))}
          className={cn(
            'h-7 rounded-lg border border-border px-2.5',
            'select-none text-[12px] text-muted-foreground/60',
            'transition-colors duration-100',
            'hover:border-border hover:bg-accent hover:text-foreground/80',
          )}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 + index * 0.04, duration: 0.25 }}
        >
          {t(action.labelKey)}
        </m.button>
      ))}
    </m.div>
  )
}

/* ─── Recent Sessions ─────────────────────────────────────────────────── */

export function NewChatRecentSessions({ owner }: { owner: ReturnType<typeof useNewChatPageOwner> }) {
  const { t } = useTranslation('new-chat')

  if (owner.recentSessions.length === 0) {
    return null
  }

  return (
    <m.div
      className="relative"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.2, duration: 0.25 }}
    >
      <div className="mx-auto max-w-160 px-6 py-4">
        <div className="mb-2.5 flex items-center gap-1.5">
          <ClockIcon className="size-3 text-muted-foreground/50" />
          <span className="select-none text-[11px] text-muted-foreground/50">{t('recent.title')}</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {owner.recentSessions.map((session, index) => (
            <m.button
              key={session.id}
              type="button"
              onClick={() => owner.handleResumeSession(session.id)}
              className={cn(
                'group flex flex-col items-start gap-1.5 rounded-xl border border-border px-3.5 py-3 text-left',
                'transition-colors duration-150',
                'hover:border-border hover:bg-accent',
              )}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + index * 0.04, duration: 0.22 }}
            >
              <div className="flex w-full items-center gap-2">
                <MessageSquareIcon className="size-3 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground/70" />
                <span className="flex-1 truncate text-[13px] text-foreground transition-colors group-hover:text-foreground">
                  {session.title || t('recent.untitled')}
                </span>
              </div>
              <time className="text-[11px] text-muted-foreground/50 transition-colors group-hover:text-muted-foreground/70" suppressHydrationWarning>
                {timeAgo(session.listActivityAt, owner.now, t)}
              </time>
            </m.button>
          ))}
        </div>
      </div>
    </m.div>
  )
}

/* ─── Main Component ──────────────────────────────────────────────────── */

function NewChatLayoutSlots({
  hasWorkspace,
  workspaceId,
}: {
  hasWorkspace: boolean
  workspaceId: string | null
}) {
  'use no memo'

  useRegisterLayoutSlots('new-chat', useMemo(() => ({
    asideWorkspaceId: hasWorkspace ? workspaceId : null,
    hasAside: hasWorkspace,
    hasBrowserPanel: hasWorkspace,
  }), [hasWorkspace, workspaceId]))

  return null
}

export function NewChatPage() {
  const isActive = useSurfaceActive()
  const owner = useNewChatPageOwner(isActive)
  const hasWorkspace = !!owner.selectedWorkspace?.path
  const isPlanMode = useNewChatStore(s => s.lastRuntimeSettings.interactionMode === 'plan')

  return (
    <div
      className="relative flex h-full flex-col bg-background"
      data-testid="new-chat-page"
      data-new-chat-ready={owner.isReady ? 'true' : 'false'}
    >
      <NewChatLayoutSlots
        hasWorkspace={hasWorkspace}
        workspaceId={owner.selectedWorkspace?.id ?? null}
      />

      <m.div
        className="pointer-events-none"
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.3 }}
        transition={{ duration: 1.2, ease: [0.25, 0.1, 0.25, 1] }}
      >
        <DitheredGradientDecoration
          rows={35}
          density={0.4}
          glowRadius={140}
          trackGlobal
          active={isActive}
          tone={isPlanMode ? 'plan' : 'neutral'}
        />
      </m.div>
      <div className="relative flex flex-1 flex-col items-center justify-center px-6 pb-4">
        <m.div
          className="w-full max-w-160"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
        >
          <NewChatComposerCard owner={owner} active={isActive} />
          <NewChatQuickActions owner={owner} />
        </m.div>
      </div>
      {/* <NewChatRecentSessions owner={owner} /> */}
    </div>
  )
}
