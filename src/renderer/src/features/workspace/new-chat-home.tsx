// Input: useWorkspaces + useInstalledAcpAgents + useAcpSessionState hooks, Button/Menu from coss
// Output: NewChatHome — new chat empty-state page with custom Composer widget
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
import { ipc } from '@renderer/lib/ipc'
import {
  BotIcon,
  ChevronDownIcon,
  FolderIcon,
  LoaderCircleIcon,
  PlusIcon,
  SendHorizonalIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useInstalledAcpAgents } from './use-acp-agents'
import { useAcpSessionState } from './use-acp-session-state'
import { useWorkspaces } from './use-workspace'

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
  const [inputValue, setInputValue] = useState('')
  const [agentId, setAgentId] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { workspaces } = useWorkspaces()
  const { agents } = useInstalledAcpAgents()

  const selectedAgent = agents.find(a => a.id === agentId) ?? null
  const selectedWorkspace = workspaces.find(w => w.id === workspaceId) ?? workspaces[0] ?? null

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
          setSessionId((resp as { sessionId: string }).sessionId)
          setAgentStatus('ready')
        }
      }
      catch {
        if (!cancelled) {
          setAgentStatus('error')
        }
      }
    }

    connect()
    // Return cleanup — uses assignment, not block statement
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      // TODO: send prompt using sessionId
    }
  }

  function autoResize(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInputValue(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }

  return (
    <div className="flex h-full flex-col items-center justify-center px-1 pt-1 pb-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-foreground/90 select-none">
        我们今天要构建什么？
      </h1>

      {/* ── Composer tray ── */}
      <div className="w-full max-w-2xl rounded-2xl bg-muted/60 p-1">

        {/* ── Input card ── */}
        <div className="rounded-xl bg-background shadow-xs border border-border/50 focus-within:ring-2 focus-within:ring-ring/30 focus-within:border-ring/50 transition-shadow">
          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={autoResize}
            onKeyDown={handleKeyDown}
            placeholder={`向 ${selectedWorkspace?.name ?? '工作区'} 提问，@ 添加文件，/ 输入命令，$ 使用技能`}
            rows={2}
            className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none min-h-25 max-h-60 rounded-t-xl"
          />

          {/* Action toolbar */}
          <div className="flex items-center justify-between gap-2 border-t border-border/50 px-3 py-2">
            {/* Left: attach */}
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-xs" aria-label="添加文件">
                <PlusIcon aria-hidden="true" />
              </Button>
            </div>

            {/* Right: Provider → Model → Thinking → send */}
            <div className="flex items-center gap-1">

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
                  <MenuPopup side="bottom" align="end" collisionAvoidance={{ side: 'none' }}>
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

              {/* Model picker — only visible when session is ready and agent exposes models */}
              {agentStatus === 'ready' && models && models.availableModels.length > 0 && (
                <Menu>
                  <MenuTrigger render={<Button variant="ghost" size="xs" className="text-muted-foreground/70 hover:text-foreground" />}>
                    {models.currentModelId}
                    <ChevronDownIcon aria-hidden="true" />
                  </MenuTrigger>
                  <MenuPopup side="bottom" align="end" collisionAvoidance={{ side: 'none' }}>
                    {models.availableModels.map(m => (
                      <MenuItem key={m.modelId} onClick={() => setModel(m.modelId)}>
                        {m.name}
                      </MenuItem>
                    ))}
                  </MenuPopup>
                </Menu>
              )}

              {/* Thinking effort — only visible when session exposes thought_level config */}
              {agentStatus === 'ready' && thoughtLevelOpts.length > 0 && thoughtLevelOption && (
                <Menu>
                  <MenuTrigger render={<Button variant="ghost" size="xs" className="text-muted-foreground/70 hover:text-foreground" />}>
                    {thoughtLevelOption.type === 'select' ? thoughtLevelOption.currentValue : thoughtLevelOption.name}
                    <ChevronDownIcon aria-hidden="true" />
                  </MenuTrigger>
                  <MenuPopup side="bottom" align="end" collisionAvoidance={{ side: 'none' }}>
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

              <Button
                variant="default"
                size="icon-xs"
                disabled={!inputValue.trim()}
                aria-label="发送"
              >
                <SendHorizonalIcon aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>

        {/* ── Context pill: workspace selector ── */}
        <div className="flex items-center gap-1 p-1">
          {workspaces.length > 0
            ? (
              <Menu>
                <MenuTrigger render={<Button variant="ghost" size="xs" className="text-muted-foreground/70 hover:text-foreground gap-2" />}>
                  <FolderIcon aria-hidden="true" />
                  {selectedWorkspace?.name ?? '选择项目'}
                  <ChevronDownIcon aria-hidden="true" />
                </MenuTrigger>
                <MenuPopup side="bottom" align="start" collisionAvoidance={{ side: 'none' }}>
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
