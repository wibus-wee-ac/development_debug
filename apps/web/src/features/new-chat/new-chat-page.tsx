import { useTabFrameActive } from '@cradle/tabs-next'
import { useQueryClient } from '@tanstack/react-query'
import type { FileUIPart } from 'ai'
import type { TFunction } from 'i18next'
import {
  ClockIcon,
  FolderIcon,
  FolderPlusIcon,
  MessageSquareIcon,
  SettingsIcon,
} from 'lucide-react'
import { m } from 'motion/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { postSessions } from '~/api-gen/sdk.gen'
import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import { Button } from '~/components/ui/button'
import { DitheredGradientDecoration } from '~/components/ui/canvas-art'
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '~/components/ui/menu'
import { startChatResponse } from '~/features/chat/chat-response-command'
import { getFallbackRuntimeSlashCommands } from '~/features/chat/chat-slash-commands'
import { Composer } from '~/features/chat/composer'
import { modelSupportsAttachments } from '~/features/chat/composer-attachment-state'
import type { MentionItem } from '~/features/chat/mention-panel'
import { ComposerToolbar, useComposerState } from '~/features/composer-toolbar'
import { useSettingsOverlayStore } from '~/store/settings-overlay'
import { sessionsQueryKey, useSessions } from '~/features/workspace/use-session'
import { useAddWorkspace, useWorkspaces, WORKSPACES_QUERY_KEY } from '~/features/workspace/use-workspace'
import { searchWorkspaceFiles } from '~/features/workspace/use-workspace-files'
import { useNow } from '~/hooks/use-now'
import { cn } from '~/lib/cn'
import { useSessionLayoutStore } from '~/store/session-layout'
import { useCradleTabStore } from '~/tabs/registry'
import { useCradleNavigation } from '~/tabs/use-cradle-navigation'

/* ─── Constants ───────────────────────────────────────────────────────── */

const PLACEHOLDER_HINT_KEYS = [
  'placeholder.task',
  'placeholder.structure',
  'placeholder.risk',
  'placeholder.fixTest',
  'placeholder.refactor',
] as const

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

/* ─── Animated Placeholder ────────────────────────────────────────────── */

function useRotatingPlaceholder(hints: string[], active: boolean, interval = 4000): string {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!active) {
      return
    }
    const timer = setInterval(() => {
      setIndex(i => (i + 1) % hints.length)
    }, interval)
    return () => clearInterval(timer)
  }, [active, hints.length, interval])

  return hints[index]
}

/* ─── Owner Hook ──────────────────────────────────────────────────────── */

function useNewChatPageOwner(active: boolean) {
  const { t } = useTranslation('new-chat')
  const composerState = useComposerState({ context: 'new-chat' })
  const { selection, effectiveAgent, effectiveProfile, effectiveModel } = composerState
  const { workspaces, loading: workspacesLoading } = useWorkspaces()
  const { openTab } = useCradleNavigation()
  const { addFromPicker, adding: addingWorkspace } = useAddWorkspace()
  const openSettings = useSettingsOverlayStore(s => s.openSettings)
  const setSettingsSection = useSettingsOverlayStore(s => s.setSettingsSection)
  const queryClient = useQueryClient()

  const [draft, setDraft] = useState('')
  const [quickActionText, setQuickActionText] = useState<string | undefined>(undefined)
  const [quickActionKey, setQuickActionKey] = useState(0)
  const [sending, setSending] = useState(false)
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
  const { sessions, loading: sessionsLoading } = useSessions(selectedProjectWorkspaceId)
  const now = useNow(60_000, active)
  const placeholderHints = useMemo(() => PLACEHOLDER_HINT_KEYS.map(key => t(key)), [t])
  const placeholder = useRotatingPlaceholder(placeholderHints, active)
  const supportsAttachments = useMemo(() => modelSupportsAttachments(effectiveModel), [effectiveModel])
  const slashCommands = useMemo(
    () => getFallbackRuntimeSlashCommands(selection.runtimeKind),
    [selection.runtimeKind],
  )
  const searchFiles = useCallback(async (query: string, signal?: AbortSignal): Promise<MentionItem[]> => {
    if (!selectedProjectWorkspaceId) {
      return []
    }
    return searchWorkspaceFiles({ workspaceId: selectedProjectWorkspaceId, query, limit: 30, signal })
  }, [selectedProjectWorkspaceId])
  const sessionsReady = selectedProjectWorkspaceId === null || !sessionsLoading
  const isReady = !workspacesLoading
    && sessionsReady
    && !composerState.isLoadingAgents
    && !composerState.isLoadingProfiles
    && !composerState.isLoadingModels

  const recentSessions = useMemo(() => {
    const top: typeof sessions = []
    for (const s of sessions) {
      if (top.length < 6) {
        top.push(s)
        top.sort((a, b) => b.updatedAt - a.updatedAt)
      }
      else if (s.updatedAt > top.at(-1)!.updatedAt) {
        top[top.length - 1] = s
        top.sort((a, b) => b.updatedAt - a.updatedAt)
      }
    }
    return top
  }, [sessions])

  const sendDisabled = selection.runtimeKind === 'cli-tui'
    ? !effectiveAgent || sending
    : !effectiveProfile || sending

  const readinessNotice = useMemo(() => {
    if (!isReady) {
      return null
    }
    if (selection.runtimeKind === 'cli-tui' && !effectiveAgent) {
      return {
        key: 'agents',
        icon: SettingsIcon,
        message: t('readiness.agent.message'),
        actionLabel: t('readiness.agent.action'),
        disabled: false,
      }
    }
    if (selection.runtimeKind !== 'cli-tui' && !effectiveProfile) {
      return {
        key: 'providers',
        icon: SettingsIcon,
        message: t('readiness.provider.message'),
        actionLabel: t('readiness.provider.action'),
        disabled: false,
      }
    }
    return null
  }, [effectiveAgent, effectiveProfile, isReady, selection.runtimeKind, t])

  const openSettingsSection = useCallback((section: string) => {
    const tabStore = useCradleTabStore.getState()
    const activeTabId = tabStore.activeTabId && tabStore.tabs.some(tab => tab.id === tabStore.activeTabId)
      ? tabStore.activeTabId
      : tabStore.tabs[0]?.id
    if (!activeTabId) {
      return
    }
    setSettingsSection(section)
    openSettings(activeTabId)
  }, [openSettings, setSettingsSection])

  const handleReadinessAction = useCallback(() => {
    if (!readinessNotice) {
      return
    }
    openSettingsSection(readinessNotice.key)
  }, [openSettingsSection, readinessNotice])

  const handleSend = useCallback(async (text: string, files: FileUIPart[]) => {
    const trimmedText = text.trim()
    const hasDraft = trimmedText.length > 0 || files.length > 0
    const canSubmit = selection.runtimeKind === 'cli-tui'
      ? !!effectiveAgent && !sending
      : !!effectiveProfile && hasDraft && !sending

    if (!canSubmit) {
      return false
    }

    setSending(true)
    try {
      if (selection.runtimeKind === 'cli-tui') {
        if (!effectiveAgent) {
          return false
        }
        const { data: sessionData } = await postSessions({
          body: {
            ...(selectedProjectWorkspaceId ? { workspaceId: selectedProjectWorkspaceId } : {}),
            title: trimmedText.slice(0, 80) || effectiveAgent.name,
            agentId: effectiveAgent.id,
          },
        })
        const session = sessionData as { id: string, workspaceId: string | null } | null
        if (!session?.id) {
          return false
        }
        useSessionLayoutStore.getState().upsertSession({
          sessionId: session.id,
          sessionTitle: trimmedText.slice(0, 80) || effectiveAgent.name,
          workspaceId: session.workspaceId ?? selectedProjectWorkspaceId ?? null,
          workspacePath: selectedWorkspace?.id === selectedProjectWorkspaceId ? selectedWorkspace.path : null,
          runtimeKind: 'cli-tui',
        })
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey(session.workspaceId ?? selectedProjectWorkspaceId) })
        queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY })
        void openTab('chat', { sessionId: session.id })
        return true
      }

      if (!effectiveProfile) {
        return false
      }
      const { data: sessionData } = await postSessions({
        body: {
          ...(selectedProjectWorkspaceId ? { workspaceId: selectedProjectWorkspaceId } : {}),
          title: trimmedText.slice(0, 80) || effectiveProfile.name,
          providerTargetId: effectiveProfile.id,
          runtimeKind: selection.runtimeKind,
        },
      })
      const session = sessionData as { id: string, workspaceId: string | null } | null
      if (!session?.id) {
        return false
      }
      useSessionLayoutStore.getState().upsertSession({
        sessionId: session.id,
        sessionTitle: trimmedText.slice(0, 80) || effectiveProfile.name,
        workspaceId: session.workspaceId ?? selectedProjectWorkspaceId ?? null,
        workspacePath: selectedWorkspace?.id === selectedProjectWorkspaceId ? selectedWorkspace.path : null,
        runtimeKind: selection.runtimeKind,
      })
      void startChatResponse({
        sessionId: session.id,
        body: {
          text: trimmedText,
          files,
          modelId: effectiveModel?.id ?? undefined,
          thinkingEffort: selection.thinkingEffort ?? undefined,
        },
      })
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey(session.workspaceId ?? selectedProjectWorkspaceId) })
      queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY })
      void openTab('chat', { sessionId: session.id })
      return true
    }
    catch (err) {
      console.error('[NewChatPage] send failed:', err)
      return false
    }
    finally {
      setSending(false)
    }
  }, [effectiveAgent, effectiveProfile, selectedProjectWorkspaceId, selectedWorkspace?.id, selectedWorkspace?.path, effectiveModel, queryClient, selection.runtimeKind, selection.thinkingEffort, sending, openTab])

  const handleQuickAction = useCallback((prompt: string) => {
    setQuickActionText(prompt)
    setQuickActionKey(key => key + 1)
  }, [])

  const handleResumeSession = useCallback((sessionId: string) => {
    void openTab('chat', { sessionId })
  }, [openTab])

  return {
    composerState,
    draft,
    effectiveWorkspaceId: selectedProjectWorkspaceId,
    handleQuickAction,
    handleReadinessAction,
    handleResumeSession,
    handleSend,
    isReady,
    now,
    openTab,
    placeholder,
    recentSessions,
    readinessNotice,
    selectedWorkspace,
    searchFiles,
    sendDisabled,
    setDraft,
    sending,
    addFromPicker,
    addingWorkspace,
    setSelectedWorkspaceId,
    t,
    quickActionKey,
    quickActionText,
    slashCommands,
    supportsAttachments,
    workspaces,
  }
}

/* ─── Composer Card ───────────────────────────────────────────────────── */

function NewChatComposerCard({ owner }: { owner: ReturnType<typeof useNewChatPageOwner> }) {
  const {
    composerState,
    handleSend,
    quickActionKey,
    quickActionText,
    sendDisabled,
    sending,
    addFromPicker,
    addingWorkspace,
    setSelectedWorkspaceId,
    setDraft,
    selectedWorkspace,
    searchFiles,
    supportsAttachments,
    t,
    placeholder,
    slashCommands,
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
    <Composer
      send={{
        submit: handleSend,
        isSending: sending,
        sendDisabled,
        allowEmptySend: composerState.selection.runtimeKind === 'cli-tui',
      }}
      commands={{
        commands: slashCommands,
      }}
      attachments={{
        supportsAttachments,
      }}
      slots={{
        toolbar: <ComposerToolbar context="new-chat" state={composerState} />,
        contextBar: workspaceSelector,
      }}
      externalSignals={{
        replaceText: quickActionText,
        replaceTextKey: quickActionKey,
      }}
      view={{
        placeholder,
        searchFiles,
        onDraftChange: setDraft,
        className: 'relative',
        cardClassName: cn(
          'overflow-hidden rounded-2xl',
          'border-border/60 bg-background shadow-none',
          'ring-1 ring-inset ring-white/[0.02] dark:ring-white/[0.04]',
          'transition-[border-color,box-shadow] duration-200',
          'focus-within:border-ring/50 focus-within:shadow-[var(--shadow-xs)]',
        ),
        textareaRows: 5,
        textareaClassName: 'px-5 pt-5 pb-3 text-[15px] leading-[1.75] placeholder:text-muted-foreground/30 min-h-30 max-h-80 rounded-t-2xl disabled:opacity-30',
        attachmentListClassName: 'border-border/60 px-3 py-2',
        actionBarClassName: 'border-t border-border/60 px-2.5 py-2',
        attachButtonClassName: 'text-muted-foreground/30',
        attachIconClassName: 'size-3',
        sendButtonClassName: 'ml-0.5',
      }}
      accessibility={{
        textareaAriaLabel: 'New chat message',
        sendButtonAriaLabel: t('send.tooltip'),
      }}
      testIds={{
        actionTarget: 'new-chat-composer-action-target',
        textarea: 'new-chat-textarea',
        fileInput: 'new-chat-file-input',
        attachButton: 'new-chat-attach-btn',
        sendButton: 'new-chat-send-btn',
      }}
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

/* ─── Readiness Notice ────────────────────────────────────────────────── */

function NewChatReadinessNotice({ owner }: { owner: ReturnType<typeof useNewChatPageOwner> }) {
  const notice = owner.readinessNotice
  if (!notice) {
    return null
  }

  const NoticeIcon = notice.icon

  return (
    <m.div
      className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-muted/35 px-3 py-2 text-[12px] text-muted-foreground"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      data-testid="new-chat-readiness-notice"
    >
      <NoticeIcon className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      <span className="min-w-0 flex-1 leading-relaxed">{notice.message}</span>
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={owner.handleReadinessAction}
        disabled={notice.disabled}
        className="h-7 shrink-0"
      >
        {notice.actionLabel}
      </Button>
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
                {timeAgo(session.updatedAt, owner.now, t)}
              </time>
            </m.button>
          ))}
        </div>
      </div>
    </m.div>
  )
}

/* ─── Main Component ──────────────────────────────────────────────────── */

export function NewChatPage() {
  const isActive = useTabFrameActive()
  const owner = useNewChatPageOwner(isActive)
  const hasWorkspace = !!owner.selectedWorkspace?.path

  useRegisterLayoutSlots('new-chat', useMemo(() => ({
    asideWorkspaceId: hasWorkspace ? owner.selectedWorkspace?.id : null,
    hasAside: hasWorkspace,
    hasBrowserPanel: hasWorkspace,
  }), [hasWorkspace, owner.selectedWorkspace?.id]))

  return (
    <div
      className="relative flex h-full flex-col bg-background"
      data-testid="new-chat-page"
      data-new-chat-ready={owner.isReady ? 'true' : 'false'}
    >
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
        />
      </m.div>
      <div className="relative flex flex-1 flex-col items-center justify-center px-6 pb-4">
        <m.div
          className="w-full max-w-160"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
        >
          <NewChatComposerCard owner={owner} />
          <NewChatReadinessNotice owner={owner} />
          <NewChatQuickActions owner={owner} />
        </m.div>
      </div>
      {/* <NewChatRecentSessions owner={owner} /> */}
    </div>
  )
}
