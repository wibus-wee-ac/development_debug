// Input: useWorkspaces + useInstalledAcpAgents + useAcpSessionState hooks, Composer, ChatSessionManager, useNavigate
// Output: NewChatHome — empty-state composer with model/thinking pickers, calls manager.createAndSend + navigates
// Position: Main content area component for the home page (/ route)

import { Button } from '@renderer/components/ui/button'
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger
} from '@renderer/components/ui/menu'
import { Composer } from '@renderer/features/chat'
import { useChatSessionManager } from '@renderer/features/chat/chat-session-manager'
import {
  acpSessionStateQueryKey,
  setAcpSessionConfigOption,
  setAcpSessionModel,
  useAcpSessionState
} from '@renderer/features/workspace/use-acp-session-state'
import { ipc } from '@renderer/lib/ipc'
import { applyStoredChatPreferences, buildStoredChatPreferences } from '@shared/chat-preferences'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  BotIcon,
  ChevronDownIcon,
  FolderIcon,
  LoaderCircleIcon,
  PlusIcon,
  TriangleAlertIcon
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useInstalledAcpAgents } from './use-acp-agents'
import { sessionsQueryKey } from './use-session'
import { useWorkspaces } from './use-workspace'
import { useWorkspaceFiles } from './use-workspace-files'

const WORD_SPLIT = /\s+/

interface FlatConfigOpt {
  value: string
  name: string
}

function flatConfigOptions(opts: unknown): FlatConfigOpt[] {
  if (!Array.isArray(opts)) {
    return []
  }
  return opts.filter(
    (o): o is FlatConfigOpt => typeof o === 'object' && o !== null && 'value' in o && 'name' in o
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

type ProbeStatus = 'idle' | 'connecting' | 'ready' | 'error'

export function NewChatHome() {
  const [agentId, setAgentId] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  // Probe session: created eagerly when agentId changes, for model/thinking picker UI
  const [probeSessionId, setProbeSessionId] = useState<string | null>(null)
  const [probeStatus, setProbeStatus] = useState<ProbeStatus>('idle')
  const [sending, setSending] = useState(false)
  const { workspaces } = useWorkspaces()
  const { agents } = useInstalledAcpAgents()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { createAndSend } = useChatSessionManager()
  const appliedProbeSessionIdRef = useRef<string | null>(null)

  const selectedAgent = agents.find((a) => a.id === agentId) ?? null
  const selectedWorkspace = workspaces.find((w) => w.id === workspaceId) ?? workspaces[0] ?? null
  const effectiveWorkspaceId = selectedWorkspace?.id ?? null
  const { files: workspaceFiles } = useWorkspaceFiles(effectiveWorkspaceId)

  // Map workspace files to MentionItems for the @ picker
  const availableFiles = useMemo(
    () => workspaceFiles.map((f) => ({ type: f.type, name: f.name, path: f.path })),
    [workspaceFiles]
  )

  // Model + config pickers from the probe session
  const { models, configOptions, setModel, setConfigOption } = useAcpSessionState(
    agentId,
    probeSessionId
  )
  const currentPreferences = useMemo(
    () =>
      buildStoredChatPreferences({
        models,
        configOptions
      }),
    [models, configOptions]
  )
  const persistChatPreferences = useCallback(
    async (preferences = currentPreferences) => {
      await ipc!.preferences.setChatPreferences(preferences)
    },
    [currentPreferences]
  )
  const thoughtLevelOption = configOptions.find((o) => o.category === 'thought_level')
  const thoughtLevelOpts = flatConfigOptions(
    thoughtLevelOption?.type === 'select' ? thoughtLevelOption.options : null
  )

  useEffect(() => {
    if (
      !agentId ||
      !probeSessionId ||
      !models ||
      appliedProbeSessionIdRef.current === probeSessionId
    ) {
      return
    }

    const stableAgentId = agentId
    const stableProbeSessionId = probeSessionId

    let cancelled = false

    async function applyPreferencesToProbeSession() {
      const preferences = await ipc!.preferences.getChatPreferences().catch(() => null)
      if (!preferences) {
        if (!cancelled) {
          appliedProbeSessionIdRef.current = stableProbeSessionId
        }
        return
      }

      await applyStoredChatPreferences({
        preferences,
        state: {
          models,
          configOptions
        },
        setModel: (modelId) => setAcpSessionModel(stableAgentId, stableProbeSessionId, modelId),
        setConfigOption: (configId, value) =>
          setAcpSessionConfigOption(stableAgentId, stableProbeSessionId, configId, value)
      })

      await queryClient.invalidateQueries({
        queryKey: acpSessionStateQueryKey(stableAgentId, stableProbeSessionId)
      })

      if (!cancelled) {
        appliedProbeSessionIdRef.current = stableProbeSessionId
      }
    }

    applyPreferencesToProbeSession().catch(() => {
      if (!cancelled) {
        appliedProbeSessionIdRef.current = stableProbeSessionId
      }
    })

    return () => {
      cancelled = true
    }
  }, [agentId, probeSessionId, models, configOptions, queryClient])

  // Auto-select first agent on load
  useEffect(() => {
    if (agentId === null && agents.length > 0) {
      setAgentId(agents[0].id)
    }
  }, [agents, agentId])

  // Probe connection: start agent + create a session for model/thinking picker UI
  useEffect(() => {
    if (!agentId) {
      return
    }

    let cancelled = false
    setProbeSessionId(null)
    setProbeStatus('connecting')
    appliedProbeSessionIdRef.current = null

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
          setProbeSessionId((resp as { sessionId: string }).sessionId)
          setProbeStatus('ready')
        }
      } catch {
        if (!cancelled) {
          setProbeStatus('error')
        }
      }
    }

    connect()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId])

  // Protocol-driven: reuse probe session, let manager own the lifecycle from here
  const handleFirstSend = useCallback(
    async (text: string) => {
      if (!agentId || !effectiveWorkspaceId || !probeSessionId) {
        return
      }

      setSending(true)
      try {
        const sessionId = await createAndSend({
          agentId,
          workspaceId: effectiveWorkspaceId,
          cwd: selectedWorkspace?.path ?? '.',
          text
        })

        queryClient.invalidateQueries({ queryKey: sessionsQueryKey(effectiveWorkspaceId) })
        navigate({ to: '/chat/$sessionId', params: { sessionId } })
      } catch (err) {
        console.error('[NewChatHome] createAndSend failed:', err)
        setSending(false)
      }
    },
    [
      agentId,
      effectiveWorkspaceId,
      probeSessionId,
      selectedWorkspace,
      createAndSend,
      queryClient,
      navigate
    ]
  )

  // ── Toolbar ──

  const composerToolbar = useMemo(
    () => (
      <Button variant="ghost" size="icon-xs" aria-label="添加文件">
        <PlusIcon aria-hidden="true" />
      </Button>
    ),
    []
  )

  const composerContextBar = useMemo(
    () => (
      <>
        {/* Agent picker */}
        {agents.length > 0 && (
          <Menu>
            <MenuTrigger render={<Button variant="ghost" size="xs" />}>
              {probeStatus === 'connecting' ? (
                <LoaderCircleIcon className="size-3 animate-spin" aria-hidden="true" />
              ) : probeStatus === 'error' ? (
                <TriangleAlertIcon className="size-3 text-destructive" aria-hidden="true" />
              ) : (
                <span className="inline-flex size-4 shrink-0 items-center justify-center rounded bg-primary/15 text-[9px] font-semibold text-primary leading-none">
                  {selectedAgent ? (
                    agentInitials(selectedAgent.name)
                  ) : (
                    <BotIcon className="size-3" aria-hidden="true" />
                  )}
                </span>
              )}
              {selectedAgent?.name ?? '选择 Agent'}
              <ChevronDownIcon aria-hidden="true" />
            </MenuTrigger>
            <MenuPopup>
              <MenuGroup>
                <MenuGroupLabel>ACP Agents</MenuGroupLabel>
                <MenuSeparator />
                {agents.map((a) => (
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
        {probeStatus === 'ready' && models && models.availableModels.length > 0 && (
          <Menu>
            <MenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground/70 hover:text-foreground"
                />
              }
            >
              {models.currentModelId}
              <ChevronDownIcon aria-hidden="true" />
            </MenuTrigger>
            <MenuPopup>
              {models.availableModels.map((m) => (
                <MenuItem
                  key={m.modelId}
                  onClick={async () => {
                    setModel(m.modelId)
                    await persistChatPreferences({
                      ...currentPreferences,
                      modelId: m.modelId
                    })
                  }}
                >
                  {m.name}
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        )}

        {/* Thinking effort */}
        {probeStatus === 'ready' && thoughtLevelOpts.length > 0 && thoughtLevelOption && (
          <Menu>
            <MenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground/70 hover:text-foreground"
                />
              }
            >
              {thoughtLevelOption.type === 'select'
                ? thoughtLevelOption.currentValue
                : thoughtLevelOption.name}
              <ChevronDownIcon aria-hidden="true" />
            </MenuTrigger>
            <MenuPopup>
              <MenuGroup>
                <MenuGroupLabel>{thoughtLevelOption.name}</MenuGroupLabel>
                <MenuSeparator />
                {thoughtLevelOpts.map((opt) => (
                  <MenuItem
                    key={opt.value}
                    onClick={async () => {
                      setConfigOption({ configId: thoughtLevelOption.id, value: opt.value })
                      await persistChatPreferences({
                        ...currentPreferences,
                        configSelections: {
                          ...currentPreferences.configSelections,
                          [thoughtLevelOption.id]: opt.value
                        }
                      })
                    }}
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
    ),
    [
      agents,
      probeStatus,
      selectedAgent,
      models,
      thoughtLevelOpts,
      thoughtLevelOption,
      currentPreferences,
      persistChatPreferences
    ]
  )

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
          disabled={probeStatus !== 'ready' || sending}
          placeholder={`向 ${selectedWorkspace?.name ?? '工作区'} 提问，@ 添加文件，/ 输入命令，$ 使用技能`}
          availableFiles={availableFiles}
          toolbar={composerToolbar}
          contextBar={composerContextBar}
        />

        {/* Context pill: workspace selector */}
        <div className="flex items-center gap-1 p-1">
          {workspaces.length > 0 ? (
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground/70 hover:text-foreground gap-2"
                  />
                }
              >
                <FolderIcon aria-hidden="true" />
                {selectedWorkspace?.name ?? '选择项目'}
                <ChevronDownIcon aria-hidden="true" />
              </MenuTrigger>
              <MenuPopup>
                {workspaces.map((w) => (
                  <MenuItem key={w.id} onClick={() => setWorkspaceId(w.id)}>
                    {w.name}
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          ) : (
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
