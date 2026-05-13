// Input: useWorkspaces, useAgentProfiles, useAgentModels, useSessions, HTTP client, router, motion
// Output: NewChatPage — premium task Composer inspired by Linear/Vercel/Devin design language
// Position: Feature component for the /new-chat route

import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpIcon,
  BotIcon,
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  CpuIcon,
  FolderIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  PaperclipIcon,
  SearchIcon,
  SparklesIcon,
  TerminalIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { postSessions } from '~/api-gen/sdk.gen'
import { Button } from '~/components/ui/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '~/components/ui/combobox'
import { Kbd } from '~/components/ui/kbd'
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from '~/components/ui/menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { useAgentModels } from '~/features/agent-runtime/use-agent-models'
import { useAgentProfiles } from '~/features/agent-runtime/use-agent-profiles'
import { useAgents } from '~/features/agent-runtime/use-agents'
import { sessionsQueryKey, useSessions } from '~/features/workspace/use-session'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { cn } from '~/lib/cn'
import type { Agent, ModelDescriptor } from '~/lib/types'
import { useNewChatStore } from '~/store/new-chat'
import { useCradleNavigation } from '~/tabs/use-cradle-navigation'

/* ─── Constants ───────────────────────────────────────────────────────── */

const WORD_SPLIT = /\s+/

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

const THINKING_EFFORTS = {
  low: { label: '快速', description: '低延迟' },
  medium: { label: '平衡', description: '速度与质量' },
  high: { label: '深度', description: '仔细推理' },
} as const

type ThinkingEffort = keyof typeof THINKING_EFFORTS

/* ─── Helpers ─────────────────────────────────────────────────────────── */

function profileInitials(name: string): string {
  const parts = name.trim().split(WORD_SPLIT)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
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
  el.style.height = 'auto'
  el.style.height = `${Math.max(el.scrollHeight, minHeight)}px`
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

/* ─── Main Component ──────────────────────────────────────────────────── */

export function NewChatPage() {
  const { workspaces } = useWorkspaces()
  const { profiles } = useAgentProfiles()
  const { agents } = useAgents()
  const { openTab } = useCradleNavigation()
  const queryClient = useQueryClient()
  const lastAgentProfileId = useNewChatStore(state => state.lastAgentProfileId)
  const setLastAgentProfileId = useNewChatStore(state => state.setLastAgentProfileId)
  const setLastModelForProfile = useNewChatStore(state => state.setLastModelForProfile)

  // ── State ──
  // selectedAgentId: when set, overrides profile/model from the Agent entity
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    () => useNewChatStore.getState().lastAgentProfileId,
  )
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<ModelDescriptor | null>(null)
  const [thinkingEffort, setThinkingEffort] = useState<ThinkingEffort | null>(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  // When an Agent is selected, resolve its underlying profile
  const selectedAgent: Agent | null = useMemo(
    () => agents.find(a => a.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  )
  const effectiveProfileId = selectedAgent?.agentProfileId ?? selectedProfileId

  const { models, isLoading: isLoadingModels } = useAgentModels(effectiveProfileId)
  const { sessions } = useSessions(selectedWorkspaceId)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const placeholder = useRotatingPlaceholder(PLACEHOLDER_HINTS)
  const lastSelectedModelId = useNewChatStore(
    state => effectiveProfileId ? state.lastModelByProfile[effectiveProfileId] : undefined,
  )

  // ── Derived ──
  const selectedProfile = profiles.find(p => p.id === effectiveProfileId) ?? null
  const selectedWorkspace = workspaces.find(w => w.id === selectedWorkspaceId) ?? null

  const effectiveModel = useMemo(() => selectedModel ?? models[0] ?? null, [selectedModel, models])
  const showModelPicker = selectedProfile && selectedProfile.providerKind !== 'cli-tui' && (isLoadingModels || models.length > 0)
  const isCliTui = selectedProfile?.providerKind === 'cli-tui'

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

  // ── Effects ──
  useEffect(() => {
    if (selectedProfileId === null && selectedAgentId === null && profiles.length > 0) {
      // Prefer agents first, fall back to profiles
      if (agents.length > 0) {
        setSelectedAgentId(agents[0].id)
      }
      else {
        const exists = lastAgentProfileId && profiles.some(p => p.id === lastAgentProfileId)
        setSelectedProfileId(exists ? lastAgentProfileId : profiles[0].id)
      }
    }
  }, [profiles, agents, selectedProfileId, selectedAgentId, lastAgentProfileId])

  useEffect(() => {
    if (selectedWorkspaceId === null && workspaces.length > 0) {
      setSelectedWorkspaceId(workspaces[0].id)
    }
  }, [workspaces, selectedWorkspaceId])

  useEffect(() => {
    setThinkingEffort(null)
  }, [effectiveProfileId])

  useEffect(() => {
    setSelectedModel((currentModel) => {
      if (!effectiveProfileId || models.length === 0 || !lastSelectedModelId) {
        return currentModel === null ? currentModel : null
      }

      const restoredModel = models.find(model => model.id === lastSelectedModelId) ?? null
      if (!restoredModel) {
        return currentModel === null ? currentModel : null
      }

      return currentModel?.id === restoredModel.id ? currentModel : restoredModel
    })
  }, [effectiveProfileId, models, lastSelectedModelId])

  useEffect(() => {
    if (effectiveProfileId && effectiveProfileId !== lastAgentProfileId) {
      setLastAgentProfileId(effectiveProfileId)
    }
  }, [effectiveProfileId, lastAgentProfileId, setLastAgentProfileId])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  // ── Handlers ──
  const canSend = !!selectedProfile && !!selectedWorkspaceId && (isCliTui || input.trim().length > 0) && !sending

  const handleSend = useCallback(async () => {
    if (!canSend || !selectedProfile || !selectedWorkspaceId || !selectedWorkspace) {
      return
    }

    setSending(true)
    try {
      if (isCliTui) {
        const { data: sessionData } = await postSessions({
          body: {
            workspaceId: selectedWorkspaceId,
            title: selectedProfile.name,
            agentProfileId: selectedProfile.id,
          },
        })
        const session = sessionData as { id: string } | null
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey(selectedWorkspaceId) })
        void openTab('chat', { sessionId: session?.id ?? '' })
        return
      }

      const { data: sessionData } = await postSessions({
        body: {
          workspaceId: selectedWorkspaceId,
          title: input.trim().slice(0, 80) || selectedProfile.name,
          agentProfileId: selectedProfile.id,
        },
      })
      const session = sessionData as { id: string } | null
      if (!session?.id) {
        return
      }
      // Trigger the response stream — wait for headers only so the server creates
      // the run before we navigate, but don't block on the SSE body.
      const serverBase = (import.meta.env as Record<string, string>).VITE_SERVER_URL ?? 'http://localhost:21423'
      const res = await fetch(`${serverBase}/chat/sessions/${session.id}/response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: input.trim(),
          modelId: effectiveModel?.id ?? undefined,
          thinkingEffort: thinkingEffort ?? undefined,
        }),
      })
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey(selectedWorkspaceId) })
      void openTab('chat', { sessionId: session.id })
    }
    catch (err) {
      console.error('[NewChatPage] send failed:', err)
    }
    finally {
      setSending(false)
    }
  }, [canSend, effectiveModel, input, isCliTui, openTab, queryClient, selectedProfile, selectedWorkspace, selectedWorkspaceId, thinkingEffort])

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

  // ── Render ──
  return (
    <div className="relative flex h-full flex-col bg-background" data-testid="new-chat-page">

      {/* Vertically centered main content */}
      <div className="relative flex flex-1 flex-col items-center justify-center px-6 pb-4">
        <motion.div
          className="w-full max-w-160"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
        >
          {/* ── Composer Card — Frame-like layered structure ────── */}
          <div
            className={cn(
              'relative overflow-hidden rounded-2xl',
              'border border-border bg-muted/50',
              'transition-[border-color] duration-200',
              'focus-within:border-ring/60',
            )}
          >
            {/* Textarea panel — elevated surface */}
            <div className="relative bg-background">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                disabled={sending}
                placeholder={isCliTui ? '按下发送以启动终端会话…' : undefined}
                data-testid="new-chat-textarea"
                rows={5}
                className={cn(
                  'block w-full resize-none bg-transparent outline-none',
                  'px-5 pt-5 pb-3 text-[15px] leading-[1.75] tracking-[-0.01em]',
                  'text-foreground',
                  'disabled:opacity-30',
                  !isCliTui && 'placeholder:text-transparent',
                  isCliTui && 'placeholder:text-muted-foreground/40 placeholder:font-light',
                )}
                style={{ minHeight: 120, maxHeight: 320 }}
              />

              {/* Animated placeholder overlay — only when empty and not cli-tui */}
              {!isCliTui && input.length === 0 && !sending && (
                <div className="pointer-events-none absolute inset-0 px-5 pt-5">
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={placeholder}
                      className="text-[15px] leading-[1.75] tracking-[-0.01em] text-muted-foreground/40 font-light"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.3 }}
                    >
                      {placeholder}
                    </motion.span>
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* ── Action Bar — recessed surface ──────────────────── */}
            <div className="flex items-center gap-1 border-t border-border/60 px-2.5 py-2">

              {/* Agent selector */}
              <Menu>
                <MenuTrigger render={<Button variant="ghost" size="xs" />} data-testid="new-chat-agent-selector">
                  {selectedAgent
                    ? (
                      <img
                        src={selectedAgent.avatarUrl || `https://api.dicebear.com/9.x/${selectedAgent.avatarStyle}/svg?seed=${selectedAgent.avatarSeed}`}
                        alt=""
                        className="size-4 shrink-0 rounded"
                        crossOrigin="anonymous"
                      />
                    )
                    : isCliTui
                      ? <TerminalIcon className="size-3 shrink-0" />
                      : selectedProfile
                        ? (
                          <span className="inline-flex size-4 shrink-0 items-center justify-center rounded bg-foreground/10 text-[8px] font-bold text-foreground/70 leading-none">
                            {profileInitials(selectedProfile.name)}
                          </span>
                        )
                        : <BotIcon className="size-3 shrink-0" />}
                  <span className="max-w-24 truncate">{selectedAgent?.name ?? selectedProfile?.name ?? 'Agent'}</span>
                  <ChevronDownIcon className="size-2.5 text-muted-foreground/30 shrink-0" />
                </MenuTrigger>
                <MenuPopup>
                  {/* Agents section */}
                  {agents.length > 0 && (
                    <MenuGroup>
                      <MenuGroupLabel>Agents</MenuGroupLabel>
                      <MenuSeparator />
                      {agents.filter(a => a.enabled).map(agent => (
                        <MenuItem
                          key={agent.id}
                          onClick={() => {
                            setSelectedAgentId(agent.id)
                            setSelectedProfileId(null)
                          }}
                        >
                          <img
                            src={agent.avatarUrl || `https://api.dicebear.com/9.x/${agent.avatarStyle}/svg?seed=${agent.avatarSeed}`}
                            alt=""
                            className="size-4 rounded"
                            crossOrigin="anonymous"
                          />
                          <span className="flex-1">{agent.name}</span>
                          {agent.id === selectedAgentId && (
                            <CheckIcon className="size-3 text-foreground/50" />
                          )}
                        </MenuItem>
                      ))}
                    </MenuGroup>
                  )}
                  {/* Profiles fallback */}
                  <MenuGroup>
                    <MenuGroupLabel>Providers</MenuGroupLabel>
                    <MenuSeparator />
                    {profiles.length === 0
                      ? <MenuItem disabled>暂无可用的 Provider</MenuItem>
                      : profiles.map(profile => (
                        <MenuItem
                          key={profile.id}
                          onClick={() => {
                            setSelectedProfileId(profile.id)
                            setSelectedAgentId(null)
                          }}
                        >
                          {profile.providerKind === 'cli-tui'
                            ? <TerminalIcon className="size-3" />
                            : <BotIcon className="size-3" />}
                          <span className="flex-1">{profile.name}</span>
                          {!selectedAgentId && profile.id === selectedProfileId && (
                            <CheckIcon className="size-3 text-foreground/50" />
                          )}
                        </MenuItem>
                      ))}
                  </MenuGroup>
                </MenuPopup>
              </Menu>

              {/* Model selector */}
              {showModelPicker && (
                isLoadingModels
                  ? (
                    <div className="inline-flex items-center gap-1 h-7 px-2 text-[12px] text-muted-foreground/40">
                      <LoaderCircleIcon className="size-3 animate-spin" />
                      <span>加载中</span>
                    </div>
                  )
                  : (
                    <Combobox<ModelDescriptor>
                      items={models}
                      value={effectiveModel}
                      itemToStringLabel={m => m.label}
                      isItemEqualToValue={(a, b) => a.id === b.id}
                      onValueChange={(next) => {
                        setSelectedModel(next ?? null)
                        if (next && effectiveProfileId) {
                          setLastModelForProfile(effectiveProfileId, next.id)
                        }
                      }}
                    >
                      <ComboboxTrigger
                        render={(
                          <Button variant="ghost" size="xs" className="text-muted-foreground/50 hover:text-foreground/70" />
                        )}
                      >
                        <CpuIcon className="size-3 shrink-0" />
                        <span className="max-w-28 truncate">{effectiveModel?.label ?? '模型'}</span>
                        <ChevronDownIcon className="size-2.5 text-muted-foreground/25 shrink-0" />
                      </ComboboxTrigger>
                      <ComboboxContent aria-label="选择模型" className="min-w-56" side="top" align="start">
                        <div className="border-b p-2">
                          <ComboboxInput
                            showTrigger={false}
                            startAddon={<SearchIcon />}
                            placeholder="搜索模型..."
                            className="rounded-md before:rounded-[calc(var(--radius-md)-1px)]"
                          />
                        </div>
                        <ComboboxEmpty>未找到匹配的模型</ComboboxEmpty>
                        <ComboboxList>
                          {(item: ModelDescriptor) => (
                            <ComboboxItem key={item.id} value={item}>
                              {item.label}
                            </ComboboxItem>
                          )}
                        </ComboboxList>
                      </ComboboxContent>
                    </Combobox>
                  )
              )}

              {/* Thinking effort selector — only for non-CLI */}
              {selectedProfile && !isCliTui && (
                <Menu>
                  <MenuTrigger render={<Button variant="ghost" size="xs" className="text-muted-foreground/40 hover:text-muted-foreground/70" />}>
                    <BrainIcon className="size-3 shrink-0" />
                    {thinkingEffort
                      ? <span className="max-w-20 truncate">{THINKING_EFFORTS[thinkingEffort].label}</span>
                      : <span>思考</span>}
                  </MenuTrigger>
                  <MenuPopup>
                    <MenuGroup>
                      <MenuGroupLabel>思考深度</MenuGroupLabel>
                      <MenuSeparator />
                      <MenuItem onClick={() => setThinkingEffort(null)}>
                        <SparklesIcon className="size-3" />
                        <span>默认</span>
                        {thinkingEffort === null && <CheckIcon className="size-3 text-foreground/50" />}
                      </MenuItem>
                      {(Object.keys(THINKING_EFFORTS) as ThinkingEffort[]).map((key) => {
                        const { label, description } = THINKING_EFFORTS[key]
                        return (
                          <MenuItem key={key} onClick={() => setThinkingEffort(key)}>
                            <BrainIcon className="size-3" />
                            <span className="flex-1">{label}</span>
                            <span className="text-[11px] text-muted-foreground/40">{description}</span>
                            {thinkingEffort === key && <CheckIcon className="size-3 text-foreground/50" />}
                          </MenuItem>
                        )
                      })}
                    </MenuGroup>
                  </MenuPopup>
                </Menu>
              )}

              {/* File attachment */}
              <Button variant="ghost" size="icon-xs" className="text-muted-foreground/30" aria-label="附加文件">
                <PaperclipIcon className="size-3" />
              </Button>

              <div className="flex-1" />

              {/* Workspace selector */}
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
                      : workspaces.map(ws => (
                        <MenuItem key={ws.id} onClick={() => setSelectedWorkspaceId(ws.id)}>
                          <FolderIcon className="size-3" />
                          <span className="flex-1">{ws.name}</span>
                          {ws.id === selectedWorkspaceId && (
                            <CheckIcon className="size-3 text-foreground/50" />
                          )}
                        </MenuItem>
                      ))}
                  </MenuGroup>
                </MenuPopup>
              </Menu>

              {/* Send button */}
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
                  >
                    {sending
                      ? <LoaderCircleIcon className="size-3.5 animate-spin" />
                      : <ArrowUpIcon className="size-3.5" />}
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

          {/* ── Quick Actions ────────────────────────────────────── */}
          {!isCliTui && input.length === 0 && (
            <motion.div
              className="mt-3 flex flex-wrap gap-1.5 px-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.3 }}
            >
              {QUICK_ACTIONS.map((action, i) => (
                <motion.button
                  key={action.label}
                  type="button"
                  onClick={() => handleQuickAction(action.prompt)}
                  className={cn(
                    'h-7 rounded-lg px-2.5',
                    'text-[12px] text-muted-foreground/60 select-none',
                    'border border-border',
                    'transition-colors duration-100',
                    'hover:border-border hover:text-foreground/80 hover:bg-accent',
                  )}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25 + i * 0.04, duration: 0.25 }}
                >
                  {action.label}
                </motion.button>
              ))}
            </motion.div>
          )}
        </motion.div>
      </div>

      {/* ── Recent Sessions ──────────────────────────────────────── */}
      {recentSessions.length > 0 && (
        <motion.div
          className="relative"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35, duration: 0.4 }}
        >
          <div className="mx-auto max-w-160 px-6 py-4">
            <div className="mb-2.5 flex items-center gap-1.5">
              <ClockIcon className="size-3 text-muted-foreground/50" />
              <span className="text-[11px] text-muted-foreground/50 select-none">最近对话</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {recentSessions.map((session, i) => (
                <motion.button
                  key={session.id}
                  type="button"
                  onClick={() => handleResumeSession(session.id)}
                  className={cn(
                    'group flex flex-col items-start gap-1.5 rounded-xl px-3.5 py-3 text-left',
                    'border border-border',
                    'transition-colors duration-150',
                    'hover:border-border hover:bg-accent',
                  )}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 + i * 0.05, duration: 0.25 }}
                >
                  <div className="flex w-full items-center gap-2">
                    <MessageSquareIcon className="size-3 shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground/70 transition-colors" />
                    <span className="flex-1 truncate text-[13px] text-foreground group-hover:text-foreground transition-colors">
                      {session.title || 'Untitled'}
                    </span>
                  </div>
                  <time dateTime={new Date(session.updatedAt).toISOString()} className="text-[11px] text-muted-foreground/50 group-hover:text-muted-foreground/70 transition-colors">
                    {timeAgo(session.updatedAt)}
                  </time>
                </motion.button>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  )
}
