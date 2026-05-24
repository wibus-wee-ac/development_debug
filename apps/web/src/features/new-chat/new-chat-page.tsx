import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpIcon,
  ClockIcon,
  FolderIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  PaperclipIcon,
  SettingsIcon,
} from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { postSessions } from '~/api-gen/sdk.gen'
import { Button } from '~/components/ui/button'
import { DitheredGradientDecoration } from '~/components/ui/canvas-art'
import { Kbd } from '~/components/ui/kbd'
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '~/components/ui/menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { startChatResponse } from '~/features/chat/chat-response-command'
import { ComposerToolbar, useComposerState } from '~/features/composer-toolbar'
import { useSettingsOverlayStore } from '~/features/settings/settings-overlay-store'
import { sessionsQueryKey, useSessions } from '~/features/workspace/use-session'
import { useAddWorkspace, useWorkspaces } from '~/features/workspace/use-workspace'
import { useNow } from '~/hooks/use-now'
import { cn } from '~/lib/cn'
import { useCradleTabStore } from '~/tabs/registry'
import { useCradleNavigation } from '~/tabs/use-cradle-navigation'

/* ─── Constants ───────────────────────────────────────────────────────── */

const PLACEHOLDER_HINTS = [
  'Describe the task you want the agent to do in this project...',
  'Explain the codebase structure and where to begin...',
  'Find risky changes and suggest the safest next step...',
  'Fix a failing test and explain the root cause...',
  'Plan a refactor before editing implementation code...',
]

const QUICK_ACTIONS = [
  { label: 'Explain this codebase', prompt: 'Explain this codebase from the perspective of a new contributor. Focus on architecture, key modules, data flow, and where I should start.' },
  { label: 'Find risky changes', prompt: 'Inspect the recent changes in this project and identify risky areas, likely regressions, and the smallest verification plan.' },
  { label: 'Fix a failing test', prompt: 'Find the failing test in this project, explain the root cause, and make the smallest maintainable fix.' },
  { label: 'Write project notes', prompt: 'Read the project context and write concise project notes that capture architecture, conventions, and important workflows.' },
  { label: 'Plan a refactor', prompt: 'Plan a focused refactor for this project. Identify the boundary, risks, migration steps, and tests before editing code.' },
]

/* ─── Helpers ─────────────────────────────────────────────────────────── */

function timeAgo(timestamp: number, now: number): string {
  const seconds = Math.floor((now - timestamp) / 1000)
  if (seconds < 60) {
    return '刚刚'
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}分钟前`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}小时前`
  }
  const days = Math.floor(hours / 24)
  if (days < 30) {
    return `${days}天前`
  }
  return `${Math.floor(days / 30)}个月前`
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
  const placeholder = useRotatingPlaceholder(PLACEHOLDER_HINTS)
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
    : !!effectiveProfile && !!effectiveWorkspaceId && input.trim().length > 0 && !sending

  const readinessNotice = useMemo(() => {
    if (!isReady) {
      return null
    }
    if (!effectiveWorkspaceId) {
      return {
        key: 'workspace',
        icon: FolderIcon,
        message: 'Add a project first so Cradle can bind the chat to a real workspace.',
        actionLabel: addingWorkspace ? 'Adding...' : 'Add project',
        disabled: addingWorkspace,
      }
    }
    if (selection.runtimeKind === 'cli-tui' && !effectiveAgent) {
      return {
        key: 'agents',
        icon: SettingsIcon,
        message: 'No CLI agent is available. Enable a local agent in settings to start.',
        actionLabel: 'Open agents',
        disabled: false,
      }
    }
    if (selection.runtimeKind !== 'cli-tui' && !effectiveProfile) {
      return {
        key: 'providers',
        icon: SettingsIcon,
        message: 'No model provider is available. Configure a provider profile before sending the first message.',
        actionLabel: 'Open providers',
        disabled: false,
      }
    }
    return null
  }, [addingWorkspace, effectiveAgent, effectiveProfile, effectiveWorkspaceId, isReady, selection.runtimeKind])

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
          agentProfileId: effectiveProfile.id,
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
          modelId: effectiveModel?.id ?? undefined,
          thinkingEffort: selection.thinkingEffort ?? undefined,
        },
      })
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey(effectiveWorkspaceId) })
      void openTab('chat', { sessionId: session.id })
    }
    catch (err) {
      console.error('[NewChatPage] send failed:', err)
    }
    finally {
      setSending(false)
    }
  }, [canSend, effectiveAgent, effectiveProfile, effectiveWorkspaceId, effectiveModel, input, queryClient, selectedWorkspace, selection.runtimeKind, selection.thinkingEffort, openTab])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void handleSend()
    }
  }, [handleSend])

  const handleQuickAction = useCallback((prompt: string) => {
    setInput(prompt)
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
    setInput(e.target.value)
    autoResize(e.target)
  }, [])

  return {
    canSend,
    composerState,
    effectiveWorkspaceId,
    handleInput,
    handleKeyDown,
    handleQuickAction,
    handleReadinessAction,
    handleResumeSession,
    handleSend,
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
    textareaRef,
    workspaces,
  }
}

/* ─── Composer Card ───────────────────────────────────────────────────── */

function NewChatComposerCard({ owner }: { owner: ReturnType<typeof useNewChatPageOwner> }) {
  const {
    canSend,
    composerState,
    handleInput,
    handleKeyDown,
    handleSend,
    input,
    sending,
    setSelectedWorkspaceId,
    selectedWorkspace,
    textareaRef,
    placeholder,
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
      <div className="relative bg-background">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          disabled={sending}
          data-testid="new-chat-textarea"
          aria-label="New chat message"
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

      <div className="flex items-center gap-1 border-t border-border/60 px-2.5 py-2">
        <ComposerToolbar context="new-chat" state={composerState} />

        <Button variant="ghost" size="icon-xs" className="text-muted-foreground/30" aria-label="Attach file">
          <PaperclipIcon className="size-3" aria-hidden="true" />
        </Button>

        <div className="flex-1" />

        <Menu>
          <MenuTrigger render={<Button variant="ghost" size="xs" className="text-muted-foreground/35 hover:text-muted-foreground/60" />} data-testid="new-chat-workspace-selector">
            <FolderIcon className="size-3 shrink-0" />
            <span className="max-w-24 truncate">{selectedWorkspace?.name ?? '项目'}</span>
          </MenuTrigger>
          <MenuPopup>
            <MenuGroup>
              <MenuGroupLabel>Workspaces</MenuGroupLabel>
              <MenuSeparator />
              {workspaces.length === 0
                ? <MenuItem disabled>暂无工作区</MenuItem>
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
              aria-label="Send message"
            >
              {sending
                ? <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden="true" />
                : <ArrowUpIcon className="size-3.5" aria-hidden="true" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <span className="inline-flex items-center gap-1.5">
              发送
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
          key={action.label}
          type="button"
          onClick={() => owner.handleQuickAction(action.prompt)}
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
          {action.label}
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
          <span className="select-none text-[11px] text-muted-foreground/50">最近对话</span>
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
                  {session.title || 'Untitled'}
                </span>
              </div>
              <time className="text-[11px] text-muted-foreground/50 transition-colors group-hover:text-muted-foreground/70" suppressHydrationWarning>
                {timeAgo(session.updatedAt, owner.now)}
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
