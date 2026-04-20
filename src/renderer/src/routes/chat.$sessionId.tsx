// Input: ChatView from chat feature, ipc.chat, ipc.session, AppLayout, TanStack Router
// Output: Chat session route — thin page that reads session from DB and renders ChatView
// Position: Route page for /chat/$sessionId, data driven by main-process ChatEngine

import { AppHeader } from '@renderer/components/layout/app-header'
import { AppLayout } from '@renderer/components/layout/app-layout'
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
import { ChatView } from '@renderer/features/chat'
import { ModelPicker } from '@renderer/features/chat/model-picker'
import { useInstalledAcpAgents } from '@renderer/features/workspace/use-acp-agents'
import {
  acpSessionStateQueryKey,
  getAcpSessionState,
  setAcpSessionConfigOption,
  setAcpSessionModel,
  useAcpSessionState,
} from '@renderer/features/workspace/use-acp-session-state'
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
import { useEffect, useMemo, useState } from 'react'

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

export const Route = createFileRoute('/chat/$sessionId')({
  /**
   * Pre-fetch messages before the route renders so there is no empty-state
   * flash on first visit.  TanStack Router blocks navigation until the loader
   * resolves (keeping the previous route visible), then renders the new route
   * with data already available.  On return visits the cached rows are used
   * directly, making session switching appear instant.
   */
  loader: async ({ params }) => {
    if (!ipc) {
      return []
    }
    return ipc.chat.getMessages(params.sessionId)
  },
  // Keep loader data fresh for 5 minutes; quick session-switching inside that
  // window reuses the cache without an extra IPC round-trip.
  staleTime: 5 * 60 * 1_000,
  gcTime: 10 * 60 * 1_000,
  component: ChatSessionPage,
})

function ChatSessionPage() {
  const { sessionId } = Route.useParams()
  const initialMessageRows = Route.useLoaderData()
  const queryClient = useQueryClient()
  const [reconnectingModel, setReconnectingModel] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [thinkingMenuOpen, setThinkingMenuOpen] = useState(false)
  const [workspaceName, setWorkspaceName] = useState<string | null>(null)
  const [liveAcpSessionId, setLiveAcpSessionId] = useState<string | null>(null)

  // Session metadata — sole source of truth is the DB row.
  const { data: session } = useQuery({
    queryKey: ['chat-session', sessionId],
    queryFn: () => (ipc ? ipc.session.get(sessionId) : Promise.resolve(undefined)),
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

  // Fetch workspace name when workspaceId is available
  useEffect(() => {
    if (!workspaceId) {
      return
    }
    ipc?.workspace.get(workspaceId).then((ws) => {
      setWorkspaceName(ws?.name ?? null)
    })
  }, [workspaceId])

  const acpSessionId = liveAcpSessionId

  const { agents } = useInstalledAcpAgents()
  const { files: workspaceFiles } = useWorkspaceFiles(workspaceId)

  const availableFiles = useMemo(
    () => workspaceFiles.map(f => ({ type: f.type, name: f.name, path: f.path })),
    [workspaceFiles],
  )

  const selectedAgent = agents.find(a => a.id === agentId) ?? null

  // Model + config pickers — keyed against acpSessionId (null = no live ACP session)
  const { models, configOptions } = useAcpSessionState(agentId, acpSessionId)

  const thoughtLevelOption = configOptions.find(o => o.category === 'thought_level')
  const thoughtLevelOpts = flatConfigOptions(
    thoughtLevelOption?.type === 'select' ? thoughtLevelOption.options : null,
  )
  const thoughtLevelSnapshot = getThoughtLevelSnapshot(session?.configSnapshot)

  async function fetchLiveSessionState(targetAcpSessionId: string) {
    return queryClient.fetchQuery({
      queryKey: acpSessionStateQueryKey(agentId, targetAcpSessionId),
      queryFn: () => getAcpSessionState(agentId!, targetAcpSessionId),
    })
  }

  async function updateSessionConfigFromLiveState(nextModelId?: string | null) {
    if (!session) {
      return
    }

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
      id: sessionId,
      modelId: mergedPreferences.modelId,
      configSnapshot: nextConfigSnapshot ?? null,
    })
    queryClient.invalidateQueries({ queryKey: ['chat-session', sessionId] })
  }

  async function reconnectAndOpenMenu(kind: MenuKind) {
    if (!ipc) {
      return
    }
    setReconnectingModel(true)
    try {
      const { liveAcpSessionId: nextAcpSessionId } = await ipc.chat.ensureLive(sessionId)
      setLiveAcpSessionId(nextAcpSessionId)
      queryClient.invalidateQueries({ queryKey: ['chat-session', sessionId] })
      await fetchLiveSessionState(nextAcpSessionId)

      if (kind === 'model') {
        setModelMenuOpen(true)
        return
      }

      setThinkingMenuOpen(true)
    }
 finally {
      setReconnectingModel(false)
    }
  }

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

    window.electron.ipcRenderer.on('chat:session-title', handler)
    return () => {
      window.electron.ipcRenderer.removeListener('chat:session-title', handler)
    }
  }, [sessionId, workspaceId, queryClient])

  const composerToolbar = useMemo(
    () => (
      <Button variant="ghost" size="icon-xs" aria-label="添加文件">
        <PlusIcon aria-hidden="true" />
      </Button>
    ),
    [],
  )

  const composerContextBar = useMemo(
    () => (
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
              await fetchLiveSessionState(acpSessionId!)
              await updateSessionConfigFromLiveState(modelId)
            }}
          />
        )
: session?.modelId
? (
          <Button
            variant="ghost"
            size="xs"
            disabled={reconnectingModel}
            className="text-muted-foreground/60 hover:text-foreground"
            onClick={() => reconnectAndOpenMenu('model')}
          >
            {reconnectingModel
? (
              <LoaderCircleIcon className="size-3 animate-spin" aria-hidden="true" />
            )
: null}
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
                      await setAcpSessionConfigOption(
                        agentId!,
                        acpSessionId!,
                        thoughtLevelOption.id,
                        opt.value,
                      )
                      await fetchLiveSessionState(acpSessionId!)
                      await updateSessionConfigFromLiveState()
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
            disabled={reconnectingModel}
            className="text-muted-foreground/60 hover:text-foreground"
            onClick={() => reconnectAndOpenMenu('thinking')}
          >
            {reconnectingModel
? (
              <LoaderCircleIcon className="size-3 animate-spin" aria-hidden="true" />
            )
: null}
            {thoughtLevelSnapshot}
            <ChevronDownIcon aria-hidden="true" />
          </Button>
        )
: null}
      </>
    ),
    [
      selectedAgent,
      session?.modelId,
      models,
      thoughtLevelOpts,
      thoughtLevelOption,
      thoughtLevelSnapshot,
      acpSessionId,
      reconnectingModel,
      modelMenuOpen,
      thinkingMenuOpen,
      queryClient,
      agentId,
      sessionId,
    ],
  )

  if (!session) {
    return (
      <AppLayout>
        <div className="flex h-full items-center justify-center">
          <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground/50" />
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout header={<AppHeader title={sessionTitle} workspace={workspaceName} />}>
      <ChatView
        sessionId={sessionId}
        initialMessageRows={initialMessageRows}
        availableFiles={availableFiles}
        composerToolbar={composerToolbar}
        composerContextBar={composerContextBar}
      />
    </AppLayout>
  )
}
