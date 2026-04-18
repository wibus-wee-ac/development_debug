// Input: useWorkspaces + useInstalledAcpAgents + useAcpSessionState hooks, ChatView, Composer, active chat store
// Output: NewChatHome — shell that shows empty-state composer or active ChatView
// Position: Main content area component for the workspace feature

import { Button } from '@renderer/components/ui/button'
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from '@renderer/components/ui/menu'
import { ChatView, Composer } from '@renderer/features/chat'
import { ipc } from '@renderer/lib/ipc'
import { useActiveChatStore } from '@renderer/store/active-chat'
import { useQueryClient } from '@tanstack/react-query'
import {
  BotIcon,
  ChevronDownIcon,
  FolderIcon,
  LoaderCircleIcon,
  PlusIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { sessionsQueryKey } from './use-session'
import { useInstalledAcpAgents } from './use-acp-agents'
import { useAcpSessionState } from './use-acp-session-state'
import { useWorkspaces } from './use-workspace'
import { useWorkspaceFiles } from './use-workspace-files'

const WORD_SPLIT = /\s+/

interface FlatConfigOpt {
  value: string
  name: string
}

/** Runtime-safe flatten — drops grouped options, keeps flat { value, name } entries */
function flatConfigOptions(opts: unknown): FlatConfigOpt[] {
  if (!Array.isArray(opts)) {
    return []
  }
  return opts.filter(
    (o): o is FlatConfigOpt =>
      typeof o === 'object' && o !== null && 'value' in o && 'name' in o,
  )
}

/** Generate a short 1-2 char abbreviation from an agent name */
function agentInitials(name: string): string {
  const parts = name.trim().split(WORD_SPLIT)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

type AgentStatus = 'idle' | 'connecting' | 'ready' | 'error'

export function NewChatHome() {
  const [agentId, setAgentId] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle')
  const [chatActive, setChatActive] = useState(false)
  const pendingMessageRef = useRef<string | null>(null)
  const { workspaces } = useWorkspaces()
  const { agents } = useInstalledAcpAgents()
  const queryClient = useQueryClient()

  // Listen for sidebar session clicks
  const storeSessionId = useActiveChatStore(s => s.sessionId)
  const storeAgentId = useActiveChatStore(s => s.agentId)
  const storeWorkspaceId = useActiveChatStore(s => s.workspaceId)

  useEffect(() => {
    if (storeSessionId && storeAgentId) {
      setSessionId(storeSessionId)
      setAgentId(storeAgentId)
      if (storeWorkspaceId) setWorkspaceId(storeWorkspaceId)
      setChatActive(true)
      setAgentStatus('ready')
    }
  }, [storeSessionId, storeAgentId, storeWorkspaceId])

  const selectedAgent = agents.find(a => a.id === agentId) ?? null
  const selectedWorkspace = workspaces.find(w => w.id === workspaceId) ?? workspaces[0] ?? null
  const effectiveWorkspaceId = selectedWorkspace?.id ?? null
  const { files: workspaceFiles } = useWorkspaceFiles(effectiveWorkspaceId)

  // Map workspace files to MentionItems for the @ picker
  const availableFiles = useMemo(
    () => workspaceFiles.map(f => ({ type: f.type, name: f.name, path: f.path })),
    [workspaceFiles],
  )

  // Session-level model + config (only available once a session is started)
  const { models, configOptions, setModel, setConfigOption } = useAcpSessionState(
    selectedAgent?.id ?? null,
    sessionId,
  )

  const thoughtLevelOption = configOptions.find(o => o.category === 'thought_level')
  const thoughtLevelOpts = flatConfigOptions(
    thoughtLevelOption?.type === 'select' ? thoughtLevelOption.options : null,
  )

  // Effect 1: when agents load and no selection yet, pick the first one
  useEffect(() => {
    if (agentId === null && agents.length > 0) {
      setAgentId(agents[0].id)
    }
  }, [agents, agentId])

  // Effect 2: whenever agentId changes, start agent process + create session
  useEffect(() => {
    if (agentId === null) {
      return
    }
    // Skip re-connecting if this was triggered by sidebar session restore
    if (storeSessionId && sessionId === storeSessionId) {
      return
    }
    let cancelled = false
    setSessionId(null)
    setAgentStatus('connecting')

    async function connect() {
      try {
        if (!ipc) {
          throw new Error('IPC not available')
        }
        const isRunning = await ipc.acp.isAgentRunning(agentId!)
        if (!isRunning) {
          await ipc.acp.startAgent(agentId!)
        }
        const cwd = selectedWorkspace?.path ?? workspaces[0]?.path ?? '.'
        const resp = await ipc.acp.createSession(agentId!, cwd)
        if (!cancelled) {
          const acpSessionId = (resp as { sessionId: string }).sessionId
          setSessionId(acpSessionId)
          setAgentStatus('ready')
          // DB session NOT created here — only created on first user message
        }
      }
      catch {
        if (!cancelled) {
          setAgentStatus('error')
        }
      }
    }

    connect()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId])

  // Effect 3: listen for ACP session title updates
  useEffect(() => {
    if (!sessionId) return

    const handler = (_event: unknown, data: { sessionId: string, title: string }) => {
      if (data.sessionId === sessionId) {
        ipc?.session.updateTitle({ id: sessionId, title: data.title })
        if (effectiveWorkspaceId) {
          queryClient.invalidateQueries({ queryKey: sessionsQueryKey(effectiveWorkspaceId) })
        }
      }
    }

    window.electron.ipcRenderer.on('acp:session-title', handler)
    return () => {
      window.electron.ipcRenderer.removeListener('acp:session-title', handler)
    }
  }, [sessionId, effectiveWorkspaceId, queryClient])

  const handleFirstSend = useCallback(async (text: string) => {
    pendingMessageRef.current = text
    setChatActive(true)

    // Create DB session on first message — use first message as fallback title
    if (sessionId && effectiveWorkspaceId && agentId) {
      const fallbackTitle = text.length > 50 ? `${text.slice(0, 50)}...` : text
      try {
        await ipc?.session.create({
          id: sessionId,
          workspaceId: effectiveWorkspaceId,
          title: fallbackTitle,
          agent: agentId,
        })
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey(effectiveWorkspaceId) })
      }
      catch {
        // Session may already exist if restored from sidebar — ignore
      }
    }
  }, [sessionId, effectiveWorkspaceId, agentId, queryClient])

  // ── Shared toolbar pieces (used in both empty-state and ChatView composers) ──

  const composerToolbar = useMemo(() => (
    <Button variant="ghost" size="icon-xs" aria-label="添加文件">
      <PlusIcon aria-hidden="true" />
    </Button>
  ), [])

  const composerContextBar = useMemo(() => (
    <>
      {/* Provider (ACP agent picker) */}
      {agents.length > 0 && (
        <Menu>
          <MenuTrigger render={<Button variant="ghost" size="xs" />}>
            {agentStatus === 'connecting'
              ? (
                <LoaderCircleIcon className="size-3 animate-spin" aria-hidden="true" />
              )
              : agentStatus === 'error'
                ? (
                  <TriangleAlertIcon className="size-3 text-destructive" aria-hidden="true" />
                )
                : (
                  <span className="inline-flex size-4 shrink-0 items-center justify-center rounded bg-primary/15 text-[9px] font-semibold text-primary leading-none">
                    {selectedAgent
                      ? agentInitials(selectedAgent.name)
                      : <BotIcon className="size-3" aria-hidden="true" />}
                  </span>
                )}
            {selectedAgent?.name ?? '选择 Agent'}
            <ChevronDownIcon aria-hidden="true" />
          </MenuTrigger>
          <MenuPopup>
            <MenuGroup>
              <MenuGroupLabel>ACP Agents</MenuGroupLabel>
              <MenuSeparator />
              {agents.map(a => (
                <MenuItem key={a.id} onClick={() => setAgentId(a.id)}>
                  <span className="inline-flex size-4 shrink-0 items-center justify-center rounded bg-primary/15 text-[9px] font-semibold text-primary leading-none">
                    {agentInitials(a.name)}
                  </span>
                  {a.name}
                </MenuItem>
              ))}
            </MenuGroup>
          </MenuPopup>
        </Menu>
      )}

      {/* Model picker */}
      {agentStatus === 'ready' && models && models.availableModels.length > 0 && (
        <Menu>
          <MenuTrigger render={<Button variant="ghost" size="xs" className="text-muted-foreground/70 hover:text-foreground" />}>
            {models.currentModelId}
            <ChevronDownIcon aria-hidden="true" />
          </MenuTrigger>
          <MenuPopup>
            {models.availableModels.map(m => (
              <MenuItem key={m.modelId} onClick={() => setModel(m.modelId)}>
                {m.name}
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      )}

      {/* Thinking effort */}
      {agentStatus === 'ready' && thoughtLevelOpts.length > 0 && thoughtLevelOption && (
        <Menu>
          <MenuTrigger render={<Button variant="ghost" size="xs" className="text-muted-foreground/70 hover:text-foreground" />}>
            {thoughtLevelOption.type === 'select' ? thoughtLevelOption.currentValue : thoughtLevelOption.name}
            <ChevronDownIcon aria-hidden="true" />
          </MenuTrigger>
          <MenuPopup>
            <MenuGroup>
              <MenuGroupLabel>{thoughtLevelOption.name}</MenuGroupLabel>
              <MenuSeparator />
              {thoughtLevelOpts.map(opt => (
                <MenuItem
                  key={opt.value}
                  onClick={() => setConfigOption({ configId: thoughtLevelOption.id, value: opt.value })}
                >
                  {opt.name}
                </MenuItem>
              ))}
            </MenuGroup>
          </MenuPopup>
        </Menu>
      )}
    </>
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [agents, agentStatus, selectedAgent, models, thoughtLevelOpts, thoughtLevelOption])

  // ── Active chat mode ──
  if (chatActive) {
    return (
      <ChatView
        agentId={agentId}
        sessionId={sessionId}
        initialMessage={pendingMessageRef.current ?? undefined}
        availableFiles={availableFiles}
        composerToolbar={composerToolbar}
        composerContextBar={composerContextBar}
        placeholder={`向 ${selectedWorkspace?.name ?? '工作区'} 提问，@ 添加文件`}
      />
    )
  }

  // ── Empty state ──
  return (
    <div className="flex h-full flex-col items-center justify-center px-1 pt-1 pb-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-foreground/90 select-none">
        我们今天要构建什么？
      </h1>

      {/* Composer tray */}
      <div className="w-full max-w-2xl rounded-2xl bg-muted/60 p-1">
        <Composer
          onSend={handleFirstSend}
          disabled={agentStatus !== 'ready'}
          placeholder={`向 ${selectedWorkspace?.name ?? '工作区'} 提问，@ 添加文件，/ 输入命令，$ 使用技能`}
          availableFiles={availableFiles}
          toolbar={composerToolbar}
          contextBar={composerContextBar}
        />

        {/* Context pill: workspace selector */}
        <div className="flex items-center gap-1 p-1">
          {workspaces.length > 0
            ? (
              <Menu>
                <MenuTrigger render={<Button variant="ghost" size="xs" className="text-muted-foreground/70 hover:text-foreground gap-2" />}>
                  <FolderIcon aria-hidden="true" />
                  {selectedWorkspace?.name ?? '选择项目'}
                  <ChevronDownIcon aria-hidden="true" />
                </MenuTrigger>
                <MenuPopup>
                  {workspaces.map(w => (
                    <MenuItem key={w.id} onClick={() => setWorkspaceId(w.id)}>{w.name}</MenuItem>
                  ))}
                </MenuPopup>
              </Menu>
            )
            : (
              <Button variant="ghost" size="xs" disabled className="text-muted-foreground/50">
                <FolderIcon aria-hidden="true" />
                无项目
              </Button>
            )}
        </div>
      </div>
    </div>
  )
}
