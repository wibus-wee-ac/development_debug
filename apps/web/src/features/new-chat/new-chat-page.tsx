import { useQueryClient } from '@tanstack/react-query'
import type { FileUIPart } from 'ai'
import type { TFunction } from 'i18next'
import {
  ArrowUpIcon,
  ClockIcon,
  FolderIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  SettingsIcon,
} from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { postSessions } from '~/api-gen/sdk.gen'
import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import { Button } from '~/components/ui/button'
import { DitheredGradientDecoration } from '~/components/ui/canvas-art'
import { Kbd } from '~/components/ui/kbd'
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '~/components/ui/menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import type { ChatComposerSlashCommand } from '~/features/chat/chat-slash-commands'
import { getFallbackRuntimeSlashCommands } from '~/features/chat/chat-slash-commands'
import { startChatResponse } from '~/features/chat/chat-response-command'
import { modelSupportsAttachments, useComposerAttachments } from '~/features/chat/composer-attachment-state'
import {
  ComposerAttachmentButton,
  ComposerAttachmentInput,
  ComposerAttachmentList,
} from '~/features/chat/composer-attachments'
import { getSlashCommandPanelItems, SlashCommandPanel } from '~/features/chat/slash-command-panel'
import {
  getActiveSlashCommand,
  readSlashTriggerState,
  replaceSlashTrigger,
} from '~/features/chat/slash-command-input'
import { ComposerToolbar, useComposerState } from '~/features/composer-toolbar'
import { useSettingsOverlayStore } from '~/features/settings/settings-overlay-store'
import { sessionsQueryKey, useSessions } from '~/features/workspace/use-session'
import { useAddWorkspace, useWorkspaces } from '~/features/workspace/use-workspace'
import { useNow } from '~/hooks/use-now'
import { cn } from '~/lib/cn'
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

function autoResize(el: HTMLTextAreaElement, minHeight = 120) {
  el.style.height = '0'
  const height = Math.max(el.scrollHeight, minHeight)
  el.style.height = `${height}px`
}

/* ─── Animated Placeholder ────────────────────────────────────────────── */

function useRotatingPlaceholder(hints: string[], interval = 4000): string {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex(i => (i + 1) % hints.length)
    }, interval)
    return () => clearInterval(timer)
  }, [hints.length, interval])

  return hints[index]
}

/* ─── Owner Hook ──────────────────────────────────────────────────────── */

function useNewChatPageOwner() {
  const { t } = useTranslation('new-chat')
  const composerState = useComposerState({ context: 'new-chat' })
  const { selection, effectiveAgent, effectiveProfile, effectiveModel } = composerState
  const { workspaces, loading: workspacesLoading } = useWorkspaces()
  const { openTab } = useCradleNavigation()
  const { addFromPicker, adding: addingWorkspace } = useAddWorkspace()
  const openSettings = useSettingsOverlayStore(s => s.openSettings)
  const setSettingsSection = useSettingsOverlayStore(s => s.setSettingsSection)
  const queryClient = useQueryClient()

  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [slashActive, setSlashActive] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [selectedSlashCommand, setSelectedSlashCommand] = useState<ChatComposerSlashCommand | null>(null)
  const [activeSlashOptionId, setActiveSlashOptionId] = useState<string | undefined>(undefined)

  const effectiveWorkspaceId = useMemo(() => {
    if (selectedWorkspaceId && workspaces.some(w => w.id === selectedWorkspaceId)) {
      return selectedWorkspaceId
    }
    return workspaces[0]?.id ?? null
  }, [selectedWorkspaceId, workspaces])

  const selectedWorkspace = workspaces.find(w => w.id === effectiveWorkspaceId) ?? null
  const { sessions, loading: sessionsLoading } = useSessions(effectiveWorkspaceId)
  const now = useNow()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const placeholderHints = useMemo(() => PLACEHOLDER_HINT_KEYS.map(key => t(key)), [t])
  const placeholder = useRotatingPlaceholder(placeholderHints)
  const supportsAttachments = useMemo(() => modelSupportsAttachments(effectiveModel), [effectiveModel])
  const attachmentController = useComposerAttachments({ supportsAttachments })
  const slashCommands = useMemo(
    () => getFallbackRuntimeSlashCommands(selection.runtimeKind),
    [selection.runtimeKind],
  )
  const slashPanelItems = useMemo(
    () => getSlashCommandPanelItems(slashCommands, slashQuery),
    [slashCommands, slashQuery],
  )
  const slashPanelHasResults = slashActive && slashPanelItems.length > 0
  const slashStartRef = useRef<number>(-1)
  const sessionsReady = effectiveWorkspaceId === null || !sessionsLoading
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

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const canSend = selection.runtimeKind === 'cli-tui'
    ? !!effectiveAgent && !!effectiveWorkspaceId && !sending
    : !!effectiveProfile && !!effectiveWorkspaceId && (input.trim().length > 0 || attachmentController.hasAttachments) && !sending

  const readinessNotice = useMemo(() => {
    if (!isReady) {
      return null
    }
    if (!effectiveWorkspaceId) {
      return {
        key: 'workspace',
        icon: FolderIcon,
        message: t('readiness.workspace.message'),
        actionLabel: addingWorkspace ? t('readiness.workspace.adding') : t('readiness.workspace.action'),
        disabled: addingWorkspace,
      }
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
  }, [addingWorkspace, effectiveAgent, effectiveProfile, effectiveWorkspaceId, isReady, selection.runtimeKind, t])

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
    if (readinessNotice.key === 'workspace') {
      void addFromPicker()
      return
    }
    openSettingsSection(readinessNotice.key)
  }, [addFromPicker, openSettingsSection, readinessNotice])

  const handleSend = useCallback(async () => {
    if (!canSend || !effectiveWorkspaceId || !selectedWorkspace) {
      return
    }

    const files: FileUIPart[] = attachmentController.attachments
    setSending(true)
    try {
      if (selection.runtimeKind === 'cli-tui') {
        if (!effectiveAgent) {
          return
        }
        const { data: sessionData } = await postSessions({
          body: {
            workspaceId: effectiveWorkspaceId,
            title: input.trim().slice(0, 80) || effectiveAgent.name,
            agentId: effectiveAgent.id,
          },
        })
        const session = sessionData as { id: string } | null
        if (!session?.id) {
          return
        }
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey(effectiveWorkspaceId) })
        void openTab('chat', { sessionId: session.id })
        return
      }

      if (!effectiveProfile) {
        return
      }
      const { data: sessionData } = await postSessions({
        body: {
          workspaceId: effectiveWorkspaceId,
          title: input.trim().slice(0, 80) || effectiveProfile.name,
          providerTargetId: effectiveProfile.id,
          runtimeKind: selection.runtimeKind,
        },
      })
      const session = sessionData as { id: string } | null
      if (!session?.id) {
        return
      }
      void startChatResponse({
        sessionId: session.id,
        body: {
          text: input.trim(),
          files,
          modelId: effectiveModel?.id ?? undefined,
          thinkingEffort: selection.thinkingEffort ?? undefined,
        },
      })
      attachmentController.clearAttachments()
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey(effectiveWorkspaceId) })
      void openTab('chat', { sessionId: session.id })
    }
    catch (err) {
      console.error('[NewChatPage] send failed:', err)
    }
    finally {
      setSending(false)
    }
  }, [attachmentController, canSend, effectiveAgent, effectiveProfile, effectiveWorkspaceId, effectiveModel, input, queryClient, selectedWorkspace, selection.runtimeKind, selection.thinkingEffort, openTab])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void handleSend()
    }
  }, [handleSend])

  const handleQuickAction = useCallback((prompt: string) => {
    setInput(prompt)
    setSlashActive(false)
    setSlashQuery('')
    setSelectedSlashCommand(null)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        autoResize(el)
      }
    })
  }, [])

  const handleResumeSession = useCallback((sessionId: string) => {
    void openTab('chat', { sessionId })
  }, [openTab])

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    const cursor = e.target.selectionStart ?? value.length
    const slashTrigger = readSlashTriggerState(value, cursor, slashCommands, selectedSlashCommand)
    setInput(value)
    autoResize(e.target)
    if (slashTrigger) {
      slashStartRef.current = slashTrigger.start
      setSlashActive(true)
      setSlashQuery(slashTrigger.query)
      setSelectedSlashCommand(slashTrigger.selectedCommand)
      return
    }
    slashStartRef.current = -1
    setSlashActive(false)
    setSlashQuery('')
    setSelectedSlashCommand(getActiveSlashCommand(value, selectedSlashCommand, slashCommands))
  }, [selectedSlashCommand, slashCommands])

  const handleSlashCommandSelect = useCallback((command: ChatComposerSlashCommand) => {
    if (command.action.kind !== 'insertText') {
      return
    }
    const cursor = textareaRef.current?.selectionStart ?? input.length
    const start = slashStartRef.current >= 0 ? slashStartRef.current : 0
    const next = replaceSlashTrigger(input, cursor, start, command.action.text)
    slashStartRef.current = -1
    setInput(next.value)
    setSlashActive(false)
    setSlashQuery('')
    setSelectedSlashCommand(command)

    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(next.cursor, next.cursor)
        autoResize(el)
      }
    })
  }, [input])

  return {
    activeSlashOptionId,
    canSend,
    attachmentController,
    composerState,
    effectiveWorkspaceId,
    handleInput,
    handleKeyDown,
    handleQuickAction,
    handleReadinessAction,
    handleResumeSession,
    handleSend,
    handleSlashCommandSelect,
    input,
    isReady,
    now,
    openTab,
    placeholder,
    recentSessions,
    readinessNotice,
    selectedWorkspace,
    sending,
    setSelectedWorkspaceId,
    setSlashActive,
    setActiveSlashOptionId,
    t,
    textareaRef,
    slashActive,
    slashCommands,
    slashPanelHasResults,
    slashQuery,
    workspaces,
  }
}

/* ─── Composer Card ───────────────────────────────────────────────────── */

function NewChatComposerCard({ owner }: { owner: ReturnType<typeof useNewChatPageOwner> }) {
  const {
    attachmentController,
    canSend,
    composerState,
    handleInput,
    handleKeyDown,
    handleSend,
    input,
    activeSlashOptionId,
    sending,
    setSelectedWorkspaceId,
    setSlashActive,
    setActiveSlashOptionId,
    selectedWorkspace,
    handleSlashCommandSelect,
    t,
    textareaRef,
    placeholder,
    slashActive,
    slashCommands,
    slashPanelHasResults,
    slashQuery,
    workspaces,
  } = owner

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl',
        'border border-border/60 bg-muted/30',
        'ring-1 ring-inset ring-white/[0.02] dark:ring-white/[0.04]',
        'transition-[border-color,box-shadow] duration-200',
        'focus-within:border-ring/50 focus-within:shadow-[var(--shadow-xs)]',
      )}
    >
      <SlashCommandPanel
        commands={slashCommands}
        listboxId="new-chat-slash-command-listbox"
        onActiveOptionIdChange={setActiveSlashOptionId}
        query={slashQuery}
        onSelect={handleSlashCommandSelect}
        onClose={() => setSlashActive(false)}
        visible={slashActive}
      />
      <div className="relative bg-background">
        <ComposerAttachmentInput
          fileInputRef={attachmentController.fileInputRef}
          onFilesSelected={attachmentController.handleFilesSelected}
          supportsAttachments={attachmentController.supportsAttachments}
          testId="new-chat-file-input"
        />
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={attachmentController.handlePaste}
          disabled={sending}
          data-testid="new-chat-textarea"
          aria-label="New chat message"
          aria-controls={slashPanelHasResults ? 'new-chat-slash-command-listbox' : undefined}
          aria-expanded={slashActive}
          aria-activedescendant={slashPanelHasResults ? activeSlashOptionId : undefined}
          rows={5}
          className={cn(
            'block w-full resize-none bg-transparent outline-none',
            'px-5 pt-5 pb-3 text-[15px] leading-[1.75] tracking-[-0.01em]',
            'text-foreground',
            'disabled:opacity-30',
            'placeholder:text-transparent',
          )}
          style={{ minHeight: 120, maxHeight: 320 }}
        />

        {input.length === 0 && !sending && (
          <div className="pointer-events-none absolute inset-0 px-5 pt-5">
            <AnimatePresence mode="wait">
              <m.span
                key={placeholder}
                className="text-[15px] leading-[1.75] tracking-[-0.01em] text-muted-foreground/30"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.15, ease: [0.0, 0.0, 0.2, 1] } }}
                exit={{ opacity: 0, y: -4, transition: { duration: 0.1, ease: [0.4, 0.0, 1.0, 1.0] } }}
              >
                {placeholder}
              </m.span>
            </AnimatePresence>
          </div>
        )}
      </div>

      <ComposerAttachmentList
        attachments={attachmentController.attachments}
        onRemove={attachmentController.removeAttachment}
        className="border-border/60 px-3 py-2"
      />

      <div className="flex items-center gap-1 border-t border-border/60 px-2.5 py-2">
        <ComposerToolbar context="new-chat" state={composerState} />

        <ComposerAttachmentButton
          disabled={sending}
          className="text-muted-foreground/30"
          iconClassName="size-3"
          onPickFiles={attachmentController.pickFiles}
          supportsAttachments={attachmentController.supportsAttachments}
          testId="new-chat-attach-btn"
        />

        <div className="flex-1" />

        <Menu>
          <MenuTrigger render={<Button variant="ghost" size="xs" className="text-muted-foreground/35 hover:text-muted-foreground/60" />} data-testid="new-chat-workspace-selector">
            <FolderIcon className="size-3 shrink-0" />
            <span className="max-w-24 truncate">{selectedWorkspace?.name ?? t('workspace.fallback')}</span>
          </MenuTrigger>
          <MenuPopup>
            <MenuGroup>
              <MenuGroupLabel>{t('workspace.group')}</MenuGroupLabel>
              <MenuSeparator />
              {workspaces.length === 0
                ? <MenuItem disabled>{t('workspace.empty')}</MenuItem>
                : workspaces.map(workspace => (
                    <MenuItem
                      key={workspace.id}
                      onClick={() => setSelectedWorkspaceId(workspace.id)}
                      data-testid={`new-chat-workspace-option-${workspace.id}`}
                    >
                      <FolderIcon className="size-3" />
                      <span className="flex-1">{workspace.name}</span>
                    </MenuItem>
                  ))}
            </MenuGroup>
          </MenuPopup>
        </Menu>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="default"
              size="icon-xs"
              disabled={!canSend}
              onClick={() => {
                void handleSend()
              }}
              className="ml-0.5"
              data-testid="new-chat-send-btn"
              aria-label={t('send.tooltip')}
            >
              {sending
                ? <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden="true" />
                : <ArrowUpIcon className="size-3.5" aria-hidden="true" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <span className="inline-flex items-center gap-1.5">
              {t('send.tooltip')}
              <Kbd>⌘</Kbd>
              <Kbd>↩</Kbd>
            </span>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

/* ─── Quick Actions ───────────────────────────────────────────────────── */

function NewChatQuickActions({ owner }: { owner: ReturnType<typeof useNewChatPageOwner> }) {
  const { t } = useTranslation('new-chat')

  if (owner.input.length > 0) {
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

function _NewChatRecentSessions({ owner }: { owner: ReturnType<typeof useNewChatPageOwner> }) {
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
  const owner = useNewChatPageOwner()
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
