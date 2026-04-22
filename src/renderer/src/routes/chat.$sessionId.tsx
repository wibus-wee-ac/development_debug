// Input: ChatView from chat feature, TuiView from tui feature, ipc.chat, ipc.session, ipc.acp, AppLayout, TanStack Router, RightAside
// Output: Chat session route — thin page that reads session from DB and renders ChatView or TuiView
// Position: Route page for /chat/$sessionId, data driven by main-process ChatEngine

import type { Session } from '@main/ipc-types'
import { AppHeader } from '@renderer/components/layout/app-header'
import { AppLayout } from '@renderer/components/layout/app-layout'
import { RightAside } from '@renderer/components/layout/right-aside'
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
import { useInstalledAcpAgents } from '@renderer/features/agent-runtime/use-acp-agents'
import {
  acpSessionStateQueryKey,
  getAcpSessionState,
  setAcpSessionConfigOption,
  setAcpSessionModel,
  useAcpSessionState,
} from '@renderer/features/agent-runtime/use-acp-session-state'
import { ChatView } from '@renderer/features/chat'
import { ModelPicker } from '@renderer/features/chat/model-picker'
import { GitBranchControl } from '@renderer/features/git'
import { ShellView } from '@renderer/features/tui/shell-view'
import { TuiView } from '@renderer/features/tui/tui-view'
import { sessionsQueryKey } from '@renderer/features/workspace/use-session'
import { useWorkspaceFiles } from '@renderer/features/workspace/use-workspace-files'
import { ipc } from '@renderer/lib/ipc'
import {
  buildStoredChatPreferencesFromSnapshot,
  mergeChatPreferencesWithState,
} from '@shared/chat-preferences'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ChevronDownIcon, LoaderCircleIcon, PlusIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

const WORD_SPLIT = /\s+/

function agentInitials(name: string): string {
  const parts = name.trim().split(WORD_SPLIT)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

interface FlatConfigOpt {
  value: string
  name: string
}

function flatConfigOptions(opts: unknown): FlatConfigOpt[] {
  if (!Array.isArray(opts)) {
    return []
  }
  return opts.filter(
    (o): o is FlatConfigOpt => typeof o === 'object' && o !== null && 'value' in o && 'name' in o,
  )
}

function getThoughtLevelSnapshot(configSnapshot: string | null | undefined): string | null {
  if (!configSnapshot) {
    return null
  }
  try {
    const parsed = JSON.parse(configSnapshot) as Array<{
      category?: string
      currentValue?: string | boolean
    }>
    const option = parsed.find(item => item.category === 'thought_level')
    return typeof option?.currentValue === 'string' ? option.currentValue : null
  }
  catch {
    return null
  }
}

type MenuKind = 'model' | 'thinking'

// ─── Static composer toolbar (never changes) ──────────────────────────────────
const ComposerToolbar = (
  <Button variant="ghost" size="icon-xs" aria-label="添加文件">
    <PlusIcon aria-hidden="true" />
  </Button>
)

// ─── Composer context bar ─────────────────────────────────────────────────────
// Isolated component so its internal state changes (open menus, reconnecting)
// do NOT trigger re-renders in the parent ChatSessionPage.

interface SessionComposerBarProps {
  session: Session
  agentId: string | null
  acpSessionId: string | null
  onAcpSessionConnect: (nextAcpSessionId: string) => void
}

function SessionComposerBar({ session, agentId, acpSessionId, onAcpSessionConnect }: SessionComposerBarProps) {
  const queryClient = useQueryClient()
  const { agents } = useInstalledAcpAgents()
  const [reconnecting, setReconnecting] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [thinkingMenuOpen, setThinkingMenuOpen] = useState(false)

  const selectedAgent = agents.find(a => a.id === agentId) ?? null
  const { models, configOptions } = useAcpSessionState(agentId, acpSessionId)

  const thoughtLevelOption = configOptions.find(o => o.category === 'thought_level')
  const thoughtLevelOpts = flatConfigOptions(
    thoughtLevelOption?.type === 'select' ? thoughtLevelOption.options : null,
  )
  const thoughtLevelSnapshot = useMemo(
    () => getThoughtLevelSnapshot(session.configSnapshot),
    [session.configSnapshot],
  )

  const fetchLiveState = useCallback(
    (targetId: string) => queryClient.fetchQuery({
      queryKey: acpSessionStateQueryKey(agentId, targetId),
      queryFn: () => getAcpSessionState(agentId!, targetId),
    }),
    [queryClient, agentId],
  )

  const updateSessionConfig = useCallback(
    async (nextModelId?: string | null) => {
      const liveState = acpSessionId
        ? await getAcpSessionState(agentId!, acpSessionId).catch(() => null)
        : null
      const mergedPreferences = mergeChatPreferencesWithState(
        buildStoredChatPreferencesFromSnapshot({
          modelId: nextModelId ?? session.modelId,
          configSnapshot: session.configSnapshot,
        }),
        liveState,
      )
      const nextConfigSnapshot = liveState?.configOptions
        ? JSON.stringify(liveState.configOptions)
        : session.configSnapshot
      await ipc?.session.updateConfig({
        id: session.id,
        modelId: mergedPreferences.modelId,
        configSnapshot: nextConfigSnapshot ?? null,
      })
      queryClient.invalidateQueries({ queryKey: ['chat-session', session.id] })
    },
    [session, agentId, acpSessionId, queryClient],
  )

  const reconnectAndOpenMenu = useCallback(
    async (kind: MenuKind) => {
      if (!ipc) {
        return
      }
      setReconnecting(true)
      try {
        const { liveAcpSessionId: nextId } = await ipc.chat.ensureLive(session.id)
        onAcpSessionConnect(nextId)
        queryClient.invalidateQueries({ queryKey: ['chat-session', session.id] })
        await fetchLiveState(nextId)
        if (kind === 'model') {
          setModelMenuOpen(true)
        }
        else {
          setThinkingMenuOpen(true)
        }
      }
      finally {
        setReconnecting(false)
      }
    },
    [session.id, queryClient, fetchLiveState, onAcpSessionConnect],
  )

  return (
    <>
      {/* Agent badge (read-only) */}
      {selectedAgent && (
        <Button variant="ghost" size="xs" disabled className="pointer-events-none">
          <span className="inline-flex size-4 shrink-0 items-center justify-center rounded bg-primary/15 text-[9px] font-semibold text-primary leading-none">
            {agentInitials(selectedAgent.name)}
          </span>
          {selectedAgent.name}
        </Button>
      )}

      {/* Model picker — live when active ACP session, else read-only snapshot */}
      {models && models.availableModels.length > 0
        ? (
          <ModelPicker
            models={models}
            open={modelMenuOpen}
            onOpenChange={setModelMenuOpen}
            onSelect={async (modelId) => {
              await setAcpSessionModel(agentId!, acpSessionId!, modelId)
              await fetchLiveState(acpSessionId!)
              await updateSessionConfig(modelId)
            }}
          />
        )
        : session.modelId
          ? (
            <Button
              variant="ghost"
              size="xs"
              disabled={reconnecting}
              className="text-muted-foreground/60 hover:text-foreground"
              onClick={() => reconnectAndOpenMenu('model')}
            >
              {reconnecting && <LoaderCircleIcon className="size-3 animate-spin" aria-hidden="true" />}
              {session.modelId}
              <ChevronDownIcon aria-hidden="true" />
            </Button>
          )
          : null}

      {/* Thinking effort — only available with active ACP session */}
      {thoughtLevelOpts.length > 0 && thoughtLevelOption
        ? (
          <Menu open={thinkingMenuOpen} onOpenChange={setThinkingMenuOpen}>
            <MenuTrigger
              render={(
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground/70 hover:text-foreground"
                />
              )}
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
                {thoughtLevelOpts.map(opt => (
                  <MenuItem
                    key={opt.value}
                    onClick={async () => {
                      await setAcpSessionConfigOption(agentId!, acpSessionId!, thoughtLevelOption.id, opt.value)
                      await fetchLiveState(acpSessionId!)
                      await updateSessionConfig()
                    }}
                  >
                    {opt.name}
                  </MenuItem>
                ))}
              </MenuGroup>
            </MenuPopup>
          </Menu>
        )
        : thoughtLevelSnapshot
          ? (
            <Button
              variant="ghost"
              size="xs"
              disabled={reconnecting}
              className="text-muted-foreground/60 hover:text-foreground"
              onClick={() => reconnectAndOpenMenu('thinking')}
            >
              {reconnecting && <LoaderCircleIcon className="size-3 animate-spin" aria-hidden="true" />}
              {thoughtLevelSnapshot}
              <ChevronDownIcon aria-hidden="true" />
            </Button>
          )
          : null}
    </>
  )
}

export const Route = createFileRoute('/chat/$sessionId')({
  validateSearch: (search: Record<string, unknown>) => ({
    tearoff: search.tearoff === 'true' || search.tearoff === true,
  }),
  /**
   * Pre-fetch both session metadata and messages before the route renders.
   * Both IPC calls run in parallel so the total wait is max(session, messages).
   * TanStack Router blocks navigation until the loader resolves — the previous
   * route stays visible — then renders the new route with all data already
   * available: no spinner, no empty-state flash.
   */
  loader: async ({ params }) => {
    if (!ipc) {
      return { session: undefined, messages: [], agent: undefined }
    }
    const [session, messages] = await Promise.all([
      ipc.session.get(params.sessionId),
      ipc.chat.getMessages(params.sessionId),
    ])
    // Determine provider: CLI agent takes precedence; fall back to ACP agent
    const cliAgent = session ? await ipc.cli.getAgent(session.agent) : undefined
    const acpAgent = !cliAgent && session ? await ipc.acp.getInstalled(session.agent) : undefined
    return { session, messages, cliAgent, acpAgent }
  },
  // Keep loader data fresh for 5 minutes; quick session-switching inside that
  // window reuses the cache without an extra IPC round-trip.
  staleTime: 5 * 60 * 1_000,
  gcTime: 10 * 60 * 1_000,
  component: ChatSessionPage,
})

function ChatSessionPage() {
  const { sessionId } = Route.useParams()
  const { tearoff } = Route.useSearch()
  const { session: loaderSession, messages: initialMessageRows, cliAgent: loaderCliAgent } = Route.useLoaderData()
  const queryClient = useQueryClient()
  const [workspaceName, setWorkspaceName] = useState<string | null>(null)
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [shellGen, setShellGen] = useState(0)
  const [liveAcpSessionId, setLiveAcpSessionId] = useState<string | null>(null)

  // Session metadata: loader provides the initial value synchronously.
  // useQuery keeps it live (title updates, config changes) without an extra
  // round-trip on first render — the loader data seeds the cache.
  const { data: session } = useQuery({
    queryKey: ['chat-session', sessionId],
    queryFn: () => (ipc ? ipc.session.get(sessionId) : Promise.resolve(undefined)),
    initialData: loaderSession ?? undefined,
    enabled: !!sessionId,
  })

  const agentId = session?.agent ?? null
  const workspaceId = session?.workspaceId ?? null
  const sessionTitle = session?.title ?? null

  // Seed liveAcpSessionId from the recoverable ACP handle persisted on the thread row
  useEffect(() => {
    if (session?.recoverableAcpSessionId && !liveAcpSessionId) {
      setLiveAcpSessionId(session.recoverableAcpSessionId)
    }
  }, [session?.recoverableAcpSessionId, liveAcpSessionId])

  // Fetch workspace name and path when workspaceId is available
  useEffect(() => {
    if (!workspaceId) {
      return
    }
    ipc?.workspace.get(workspaceId).then((ws) => {
      setWorkspaceName(ws?.name ?? null)
      setWorkspacePath(ws?.path ?? null)
    })
  }, [workspaceId])

  const { files: workspaceFiles } = useWorkspaceFiles(workspaceId)
  const availableFiles = useMemo(
    () => workspaceFiles.map(f => ({ type: f.type, name: f.name, path: f.path })),
    [workspaceFiles],
  )

  // PTY title updates for cli-tui sessions
  useEffect(() => {
    if (!loaderCliAgent) {
      return
    }
    const unsub = window.ptyPush.onTitle((sid, title) => {
      if (sid !== sessionId) {
        return
      }
      void ipc?.session.updateTitle({ id: sessionId, title })
      queryClient.invalidateQueries({ queryKey: ['chat-session', sessionId] })
      if (workspaceId) {
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspaceId) })
      }
    })
    return unsub
  }, [sessionId, loaderCliAgent, workspaceId, queryClient])

  // Engine forwards ACP title updates as chat:session-title with chatSessionId.
  useEffect(() => {
    const handler = (_event: unknown, data: { chatSessionId: string, title: string }) => {
      if (data.chatSessionId !== sessionId) {
        return
      }
      queryClient.invalidateQueries({ queryKey: ['chat-session', sessionId] })
      if (workspaceId) {
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspaceId) })
      }
    }
    const off = window.electron.ipcRenderer.on('chat:session-title', handler)
    return off
  }, [sessionId, workspaceId, queryClient])

  if (!session) {
    return (
      <AppLayout hideSidebar={tearoff}>
        <div className="flex h-full items-center justify-center">
          <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground/50" />
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout
      hideSidebar={tearoff}
      header={<AppHeader title={sessionTitle} workspace={workspaceName} hasAside hasPanel={!!(workspaceId && workspacePath)} trafficLight={tearoff} gitBranch={<GitBranchControl workspacePath={workspacePath} />} />}
      aside={<RightAside workspaceId={workspaceId} workspacePath={workspacePath} />}
      panel={workspaceId && workspacePath
        ? (
          <ShellView
            key={shellGen}
            ptyId={`shell:${sessionId}:${shellGen}`}
            cwd={workspacePath}
            onExited={() => setShellGen(g => g + 1)}
          />
        )
        : undefined}
    >
      {loaderCliAgent
        ? (
          <TuiView sessionId={sessionId} />
        )
        : (
          <ChatView
            sessionId={sessionId}
            initialMessageRows={initialMessageRows}
            availableFiles={availableFiles}
            composerToolbar={ComposerToolbar}
            composerContextBar={(
              <SessionComposerBar
                session={session}
                agentId={agentId}
                acpSessionId={liveAcpSessionId}
                onAcpSessionConnect={setLiveAcpSessionId}
              />
            )}
          />
        )}
    </AppLayout>
  )
}
