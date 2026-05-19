// Input: useComposerState, ComposerToolbar, workspaces, sessions, HTTP client, motion
// Output: NewChatPage — premium task Composer inspired by Linear/Vercel/Devin design language
// Position: Feature component for the /new-chat route

import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpIcon,
  ClockIcon,
  FolderIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  PaperclipIcon,
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
import { sessionsQueryKey, useSessions } from '~/features/workspace/use-session'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { useNow } from '~/hooks/use-now'
import { cn } from '~/lib/cn'
import { useCradleNavigation } from '~/tabs/use-cradle-navigation'

/* ─── Constants ───────────────────────────────────────────────────────── */

const PLACEHOLDER_HINTS = [
  '描述你想让 Agent 完成的任务…',
  '审查最近的代码变更并给出建议…',
  '帮我排查这个 bug 的根本原因…',
  '为这个模块编写单元测试…',
  '重构这段代码，提升可读性…',
]

const QUICK_ACTIONS = [
  { label: 'Review code', prompt: '请审查我最近的代码变更，指出潜在的问题和改进建议' },
  { label: 'Fix tests', prompt: '帮我修复当前失败的测试用例' },
  { label: 'Refactor', prompt: '请重构以下代码，提升可读性和性能' },
  { label: 'Write docs', prompt: '为以下模块编写清晰完整的文档' },
  { label: 'Debug', prompt: '帮我排查以下问题的根本原因' },
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
  const { workspaces } = useWorkspaces()
  const { openTab } = useCradleNavigation()
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
  const { sessions } = useSessions(effectiveWorkspaceId)
  const now = useNow()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const placeholder = useRotatingPlaceholder(PLACEHOLDER_HINTS)

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
      await startChatResponse({
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
    handleResumeSession,
    handleSend,
    input,
    now,
    openTab,
    placeholder,
    recentSessions,
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
                    <MenuItem key={workspace.id} onClick={() => setSelectedWorkspaceId(workspace.id)}>
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

/* ─── Recent Sessions ─────────────────────────────────────────────────── */

function NewChatRecentSessions({ owner }: { owner: ReturnType<typeof useNewChatPageOwner> }) {
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
    <div className="relative flex h-full flex-col bg-background" data-testid="new-chat-page">
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
          <NewChatQuickActions owner={owner} />
        </m.div>
      </div>
      {/* <NewChatRecentSessions owner={owner} /> */}
    </div>
  )
}
