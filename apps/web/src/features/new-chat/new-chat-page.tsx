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
} from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'

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
import { startChatResponse } from '~/features/chat/chat-response-command'
import { sessionsQueryKey, useSessions } from '~/features/workspace/use-session'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { useNow } from '~/hooks/use-now'
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

interface NewChatDraftState {
  selectedAgentId: string | null
  selectedProfileId: string | null
  selectedWorkspaceId: string | null
  selectedModelId: string | null
  thinkingEffortProfileId: string | null
  thinkingEffort: ThinkingEffort | null
  input: string
  sending: boolean
}

type NewChatDraftAction = { type: 'select-agent', agentId: string }
  | { type: 'select-profile', profileId: string }
  | { type: 'restore-profile', profileId: string }
  | { type: 'select-workspace', workspaceId: string }
  | { type: 'select-model', modelId: string | null }
  | { type: 'set-thinking-effort', profileId: string | null, thinkingEffort: ThinkingEffort | null }
  | { type: 'set-input', input: string }
  | { type: 'set-sending', sending: boolean }

function createInitialNewChatDraftState(selectedProfileId: string | null | undefined): NewChatDraftState {
  return {
    selectedAgentId: null,
    selectedProfileId: selectedProfileId ?? null,
    selectedWorkspaceId: null,
    selectedModelId: null,
    thinkingEffortProfileId: null,
    thinkingEffort: null,
    input: '',
    sending: false,
  }
}

function newChatDraftReducer(state: NewChatDraftState, action: NewChatDraftAction): NewChatDraftState {
  switch (action.type) {
    case 'select-agent':
      return {
        ...state,
        selectedAgentId: action.agentId,
        selectedProfileId: null,
        selectedModelId: null,
      }
    case 'select-profile':
      return {
        ...state,
        selectedAgentId: null,
        selectedProfileId: action.profileId,
        selectedModelId: null,
      }
    case 'restore-profile':
      if (state.selectedAgentId || state.selectedProfileId) {
        return state
      }
      return {
        ...state,
        selectedProfileId: action.profileId,
        selectedModelId: null,
      }
    case 'select-workspace':
      return { ...state, selectedWorkspaceId: action.workspaceId }
    case 'select-model':
      return { ...state, selectedModelId: action.modelId }
    case 'set-thinking-effort':
      return {
        ...state,
        thinkingEffortProfileId: action.profileId,
        thinkingEffort: action.thinkingEffort,
      }
    case 'set-input':
      return { ...state, input: action.input }
    case 'set-sending':
      return { ...state, sending: action.sending }
    default:
      return state
  }
}

function useNewChatPageOwner() {
  const { workspaces } = useWorkspaces()
  const { profiles } = useAgentProfiles()
  const { agents } = useAgents()
  const { openTab } = useCradleNavigation()
  const queryClient = useQueryClient()
  const lastAgentProfileId = useNewChatStore(state => state.lastAgentProfileId)
  const setLastAgentProfileId = useNewChatStore(state => state.setLastAgentProfileId)
  const setLastModelForProfile = useNewChatStore(state => state.setLastModelForProfile)
  const [draft, dispatch] = useReducer(newChatDraftReducer, lastAgentProfileId, createInitialNewChatDraftState)

  const selectedAgent: Agent | null = useMemo(
    () => agents.find(agent => agent.id === draft.selectedAgentId && agent.enabled) ?? null,
    [agents, draft.selectedAgentId],
  )

  const selectedProfileId = useMemo(() => {
    if (!draft.selectedProfileId) {
      return null
    }
    return profiles.some(profile => profile.id === draft.selectedProfileId) ? draft.selectedProfileId : null
  }, [draft.selectedProfileId, profiles])

  const fallbackAgent = useMemo(() => {
    if (selectedAgent || selectedProfileId) {
      return null
    }
    return agents.find(agent => agent.enabled) ?? null
  }, [agents, selectedAgent, selectedProfileId])

  const preferredProfileId = useMemo(() => {
    if (lastAgentProfileId && profiles.some(profile => profile.id === lastAgentProfileId)) {
      return lastAgentProfileId
    }
    return profiles[0]?.id ?? null
  }, [lastAgentProfileId, profiles])

  const effectiveAgent = selectedAgent ?? fallbackAgent
  const effectiveProfileId = effectiveAgent?.agentProfileId ?? selectedProfileId ?? preferredProfileId
  const effectiveWorkspaceId = useMemo(() => {
    if (draft.selectedWorkspaceId && workspaces.some(workspace => workspace.id === draft.selectedWorkspaceId)) {
      return draft.selectedWorkspaceId
    }
    return workspaces[0]?.id ?? null
  }, [draft.selectedWorkspaceId, workspaces])

  const { models, isLoading: isLoadingModels } = useAgentModels(effectiveProfileId)
  const { sessions } = useSessions(effectiveWorkspaceId)
  const now = useNow()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const placeholder = useRotatingPlaceholder(PLACEHOLDER_HINTS)
  const lastSelectedModelId = useNewChatStore(
    state => effectiveProfileId ? state.lastModelByProfile[effectiveProfileId] : undefined,
  )

  const selectedProfile = profiles.find(p => p.id === effectiveProfileId) ?? null
  const selectedWorkspace = workspaces.find(w => w.id === effectiveWorkspaceId) ?? null

  const selectedModel = useMemo(
    () => draft.selectedModelId ? models.find(model => model.id === draft.selectedModelId) ?? null : null,
    [draft.selectedModelId, models],
  )
  const restoredModel = useMemo(
    () => lastSelectedModelId ? models.find(model => model.id === lastSelectedModelId) ?? null : null,
    [lastSelectedModelId, models],
  )
  const effectiveModel = selectedModel ?? restoredModel ?? models[0] ?? null
  const thinkingEffort = draft.thinkingEffortProfileId === effectiveProfileId ? draft.thinkingEffort : null

  const showModelPicker = selectedProfile && (isLoadingModels || models.length > 0)
  const isCliTui = false // cli-tui is now a runtime, not a provider kind

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

  useEffect(() => {
    if (!lastAgentProfileId) {
      return
    }
    if (!profiles.some(profile => profile.id === lastAgentProfileId)) {
      return
    }
    dispatch({ type: 'restore-profile', profileId: lastAgentProfileId })
  }, [lastAgentProfileId, profiles])

  const selectAgent = useCallback((agentId: string) => {
    const nextAgent = agents.find(agent => agent.id === agentId) ?? null
    dispatch({ type: 'select-agent', agentId })
    if (nextAgent?.agentProfileId) {
      setLastAgentProfileId(nextAgent.agentProfileId)
    }
  }, [agents, setLastAgentProfileId])

  const selectProfile = useCallback((profileId: string) => {
    dispatch({ type: 'select-profile', profileId })
    setLastAgentProfileId(profileId)
  }, [setLastAgentProfileId])

  const selectWorkspace = useCallback((workspaceId: string) => {
    dispatch({ type: 'select-workspace', workspaceId })
  }, [])

  const selectModel = useCallback((nextModel: ModelDescriptor | null) => {
    dispatch({ type: 'select-model', modelId: nextModel?.id ?? null })
    if (nextModel && effectiveProfileId) {
      setLastModelForProfile(effectiveProfileId, nextModel.id)
    }
  }, [effectiveProfileId, setLastModelForProfile])

  const selectThinkingEffort = useCallback((nextThinkingEffort: ThinkingEffort | null) => {
    dispatch({
      type: 'set-thinking-effort',
      profileId: effectiveProfileId,
      thinkingEffort: nextThinkingEffort,
    })
  }, [effectiveProfileId])

  const setInput = useCallback((input: string) => {
    dispatch({ type: 'set-input', input })
  }, [])

  const canSend = !!selectedProfile && !!effectiveWorkspaceId && (isCliTui || draft.input.trim().length > 0) && !draft.sending

  const handleSend = useCallback(async () => {
    if (!canSend || !selectedProfile || !effectiveWorkspaceId || !selectedWorkspace) {
      return
    }

    dispatch({ type: 'set-sending', sending: true })
    try {
      if (isCliTui) {
        const { data: sessionData } = await postSessions({
          body: {
            workspaceId: effectiveWorkspaceId,
            title: selectedProfile.name,
            agentProfileId: selectedProfile.id,
            runtimeKind: effectiveAgent?.runtimeKind ?? undefined,
          },
        })
        const session = sessionData as { id: string } | null
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey(effectiveWorkspaceId) })
        void openTab('chat', { sessionId: session?.id ?? '' })
        return
      }

      const { data: sessionData } = await postSessions({
        body: {
          workspaceId: effectiveWorkspaceId,
          title: draft.input.trim().slice(0, 80) || selectedProfile.name,
          agentProfileId: selectedProfile.id,
          runtimeKind: effectiveAgent?.runtimeKind ?? undefined,
        },
      })
      const session = sessionData as { id: string } | null
      if (!session?.id) {
        return
      }
      // Trigger the response stream — wait for headers only so the server creates
      // the run before we navigate, but don't block on the SSE body.
      await startChatResponse({
        sessionId: session.id,
        body: {
          text: draft.input.trim(),
          modelId: effectiveModel?.id ?? undefined,
          thinkingEffort: thinkingEffort ?? undefined,
        },
      })
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey(effectiveWorkspaceId) })
      void openTab('chat', { sessionId: session.id })
    }
    catch (err) {
      console.error('[NewChatPage] send failed:', err)
    }
    finally {
      dispatch({ type: 'set-sending', sending: false })
    }
  }, [canSend, draft.input, effectiveAgent?.runtimeKind, effectiveModel, effectiveWorkspaceId, isCliTui, openTab, queryClient, selectedProfile, selectedWorkspace, thinkingEffort])

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
  }, [setInput])

  const handleResumeSession = useCallback((sessionId: string) => {
    void openTab('chat', { sessionId })
  }, [openTab])

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    autoResize(e.target)
  }, [setInput])

  return {
    agents,
    canSend,
    draft,
    effectiveModel,
    effectiveProfileId,
    handleInput,
    handleKeyDown,
    handleQuickAction,
    handleResumeSession,
    handleSend,
    isCliTui,
    isLoadingModels,
    models,
    now,
    openTab,
    placeholder,
    profiles,
    recentSessions,
    selectAgent,
    selectModel,
    selectProfile,
    selectThinkingEffort,
    selectedAgent: effectiveAgent,
    selectedProfile,
    selectedWorkspace,
    selectWorkspace,
    sending: draft.sending,
    showModelPicker,
    textareaRef,
    thinkingEffort,
    workspaces,
  }
}

function NewChatComposerCard({ owner }: { owner: ReturnType<typeof useNewChatPageOwner> }) {
  const {
    agents,
    canSend,
    draft,
    effectiveModel,
    effectiveProfileId,
    handleInput,
    handleKeyDown,
    handleSend,
    isCliTui,
    isLoadingModels,
    models,
    placeholder,
    profiles,
    selectAgent,
    selectModel,
    selectProfile,
    selectThinkingEffort,
    selectedAgent,
    selectedProfile,
    selectedWorkspace,
    selectWorkspace,
    sending,
    showModelPicker,
    textareaRef,
    thinkingEffort,
    workspaces,
  } = owner

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl',
        'border border-border bg-muted/50',
        'transition-[border-color] duration-200',
        'focus-within:border-ring/60',
      )}
    >
      <div className="relative bg-background">
        <textarea
          ref={textareaRef}
          value={draft.input}
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

        {!isCliTui && draft.input.length === 0 && !sending && (
          <div className="pointer-events-none absolute inset-0 px-5 pt-5">
            <AnimatePresence mode="wait">
              <m.span
                key={placeholder}
                className="font-light text-[15px] leading-[1.75] tracking-[-0.01em] text-muted-foreground/40"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.3 }}
              >
                {placeholder}
              </m.span>
            </AnimatePresence>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 border-t border-border/60 px-2.5 py-2">
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
              : selectedProfile
                  ? (
                    <span className="inline-flex size-4 shrink-0 items-center justify-center rounded bg-foreground/10 text-[8px] font-bold leading-none text-foreground/70">
                      {profileInitials(selectedProfile.name)}
                    </span>
                  )
                  : <BotIcon className="size-3 shrink-0" />}
            <span className="max-w-24 truncate">{selectedAgent?.name ?? selectedProfile?.name ?? 'Agent'}</span>
            <ChevronDownIcon className="size-2.5 shrink-0 text-muted-foreground/30" />
          </MenuTrigger>
          <MenuPopup>
            {agents.length > 0 && (
              <MenuGroup>
                <MenuGroupLabel>Agents</MenuGroupLabel>
                <MenuSeparator />
                {agents.flatMap(agent => agent.enabled
                  ? [
                      <MenuItem key={agent.id} onClick={() => selectAgent(agent.id)}>
                        <img
                          src={agent.avatarUrl || `https://api.dicebear.com/9.x/${agent.avatarStyle}/svg?seed=${agent.avatarSeed}`}
                          alt=""
                          className="size-4 rounded"
                          crossOrigin="anonymous"
                        />
                        <span className="flex-1">{agent.name}</span>
                        {agent.id === selectedAgent?.id && <CheckIcon className="size-3 text-foreground/50" />}
                      </MenuItem>,
                    ]
                  : [])}
              </MenuGroup>
            )}
            <MenuGroup>
              <MenuGroupLabel>Agent Profiles</MenuGroupLabel>
              <MenuSeparator />
              {profiles.length === 0
                ? <MenuItem disabled>暂无可用的 Provider</MenuItem>
                : profiles.map(profile => (
                    <MenuItem key={profile.id} onClick={() => selectProfile(profile.id)}>
                      <BotIcon className="size-3" />
                      <span className="flex-1">{profile.name}</span>
                      {!selectedAgent && profile.id === effectiveProfileId && (
                        <CheckIcon className="size-3 text-foreground/50" />
                      )}
                    </MenuItem>
                  ))}
            </MenuGroup>
          </MenuPopup>
        </Menu>

        {showModelPicker && (
          isLoadingModels
            ? (
              <div className="inline-flex h-7 items-center gap-1 px-2 text-[12px] text-muted-foreground/40">
                <LoaderCircleIcon className="size-3 animate-spin" />
                <span>加载中</span>
              </div>
            )
            : (
              <Combobox<ModelDescriptor>
                items={models}
                value={effectiveModel}
                itemToStringLabel={model => model.label}
                isItemEqualToValue={(a, b) => a.id === b.id}
                onValueChange={selectModel}
              >
                <ComboboxTrigger
                  render={(
                    <Button variant="ghost" size="xs" className="text-muted-foreground/50 hover:text-foreground/70" data-testid="new-chat-model-selector" />
                  )}
                >
                  <CpuIcon className="size-3 shrink-0" />
                  <span className="max-w-28 truncate">{effectiveModel?.label ?? '模型'}</span>
                  <ChevronDownIcon className="size-2.5 shrink-0 text-muted-foreground/25" />
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
                <MenuItem onClick={() => selectThinkingEffort(null)}>
                  <SparklesIcon className="size-3" />
                  <span>默认</span>
                  {thinkingEffort === null && <CheckIcon className="size-3 text-foreground/50" />}
                </MenuItem>
                {(Object.keys(THINKING_EFFORTS) as ThinkingEffort[]).map((key) => {
                  const { label, description } = THINKING_EFFORTS[key]
                  return (
                    <MenuItem key={key} onClick={() => selectThinkingEffort(key)}>
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

        <Button variant="ghost" size="icon-xs" className="text-muted-foreground/30" aria-label="附加文件">
          <PaperclipIcon className="size-3" />
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
                    <MenuItem key={workspace.id} onClick={() => selectWorkspace(workspace.id)}>
                      <FolderIcon className="size-3" />
                      <span className="flex-1">{workspace.name}</span>
                      {workspace.id === selectedWorkspace?.id && <CheckIcon className="size-3 text-foreground/50" />}
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
  )
}

function NewChatQuickActions({ owner }: { owner: ReturnType<typeof useNewChatPageOwner> }) {
  if (owner.isCliTui || owner.draft.input.length > 0) {
    return null
  }

  return (
    <m.div
      className="mt-3 flex flex-wrap gap-1.5 px-1"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.2, duration: 0.3 }}
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

function NewChatRecentSessions({ owner }: { owner: ReturnType<typeof useNewChatPageOwner> }) {
  if (owner.recentSessions.length === 0) {
    return null
  }

  return (
    <m.div
      className="relative"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.35, duration: 0.4 }}
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
              transition={{ delay: 0.4 + index * 0.05, duration: 0.25 }}
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
      <div className="relative flex flex-1 flex-col items-center justify-center px-6 pb-4">
        <m.div
          className="w-full max-w-160"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
        >
          <NewChatComposerCard owner={owner} />
          <NewChatQuickActions owner={owner} />
        </m.div>
      </div>
      <NewChatRecentSessions owner={owner} />
    </div>
  )
}
