// Input: ChatView, TuiView, ShellView features, agent-runtime hooks, AppLayout, combobox UI
// Output: ChatSessionPage lazy component for /chat/$sessionId
// Position: Lazy-loaded component chunk — contains heavy deps (xterm, AI SDK, combobox, etc.)

import type { Session } from '@main/ipc-types'
import { AppLayout } from '@renderer/components/layout/app-layout'
import { RightAside } from '@renderer/components/layout/right-aside'
import { Button } from '@renderer/components/ui/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@renderer/components/ui/combobox'
import { RouteLoadingFallback } from '@renderer/components/ui/route-loading-fallback'
import { useAgentModels } from '@renderer/features/agent-runtime/use-agent-models'
import { useAgentProfiles } from '@renderer/features/agent-runtime/use-agent-profiles'
import { useAgents } from '@renderer/features/agent-runtime/use-agents'
import { ChatView } from '@renderer/features/chat'
import { useChatSessionTitle } from '@renderer/features/chat/use-chat-events'
import { GitBranchControl } from '@renderer/features/git'
import { ShellView } from '@renderer/features/tui/shell-view'
import { TuiView } from '@renderer/features/tui/tui-view'
import { sessionsQueryKey } from '@renderer/features/workspace/use-session'
import { useWorkspaceFiles } from '@renderer/features/workspace/use-workspace-files'
import { ipc } from '@renderer/lib/ipc'
import { useLayoutStore } from '@renderer/store/layout'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createLazyFileRoute } from '@tanstack/react-router'
import { BotIcon, ChevronDownIcon, CpuIcon, LoaderCircleIcon, PlusIcon, TerminalIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

const WORD_SPLIT = /\s+/

function agentInitials(name: string): string {
  const parts = name.trim().split(WORD_SPLIT)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

// ─── Static composer toolbar (never changes) ──────────────────────────────────
const ComposerToolbar = (
  <Button variant="ghost" size="icon-xs" aria-label="添加文件">
    <PlusIcon aria-hidden="true" />
  </Button>
)

// ─── Composer context bar ─────────────────────────────────────────────────────

interface SessionComposerBarProps {
  session: Session
}

function SessionComposerBar({ session }: SessionComposerBarProps) {
  const { profiles } = useAgentProfiles()
  const { agents } = useAgents()
  const { models, isLoading: isLoadingModels } = useAgentModels(session.agentProfileId ?? null)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(session.modelId ?? null)
  const queryClient = useQueryClient()

  const selectedProfile = profiles.find(p => p.id === session.agentProfileId) ?? null
  const sessionAgent = session.agentId ? agents.find(a => a.id === session.agentId) ?? null : null
  const selectedModel = models.find(m => m.id === selectedModelId) ?? models[0] ?? null

  const handleModelSelect = async (modelId: string) => {
    setSelectedModelId(modelId)
    await ipc?.session.updateConfig({ id: session.id, modelId, configSnapshot: session.configSnapshot ?? null })
    queryClient.invalidateQueries({ queryKey: ['chat-session', session.id] })
  }

  return (
    <>
      {/* Agent / Provider badge */}
      {sessionAgent
        ? (
          <Button variant="ghost" size="xs" disabled className="pointer-events-none">
            <img
              src={sessionAgent.avatarUrl!}
              alt=""
              className="size-4 rounded-full"
            />
            {sessionAgent.name}
          </Button>
        )
        : selectedProfile && (
          <Button variant="ghost" size="xs" disabled className="pointer-events-none">
            {selectedProfile.providerKind === 'cli-tui'
              ? <TerminalIcon className="size-3" aria-hidden="true" />
              : (
                <span className="inline-flex size-4 shrink-0 items-center justify-center rounded bg-primary/15 text-[9px] font-semibold text-primary leading-none">
                  {agentInitials(selectedProfile.name)}
                </span>
              )}
            {selectedProfile.name}
          </Button>
        )}

      {/* Model picker — hidden when session belongs to an Agent (model is fixed) */}
      {!session.agentId && (isLoadingModels
        ? (
          <Button variant="ghost" size="xs" disabled>
            <LoaderCircleIcon className="size-3 animate-spin" aria-hidden="true" />
            加载模型...
          </Button>
        )
        : models.length > 0
          ? (
            <Combobox
              items={models}
              value={selectedModel}
              itemToStringLabel={m => m.label}
              isItemEqualToValue={(a, b) => a.id === b.id}
              onValueChange={(next) => {
                if (next) {
                  void handleModelSelect(next.id)
                }
              }}
            >
              <ComboboxTrigger
                render={(
                  <Button variant="ghost" size="xs" className="text-muted-foreground/70 hover:text-foreground" />
                )}
              >
                <CpuIcon className="size-3" aria-hidden="true" />
                {selectedModel?.label ?? '默认模型'}
                <ChevronDownIcon aria-hidden="true" />
              </ComboboxTrigger>
              <ComboboxContent aria-label="选择模型" className="min-w-60" side="left">
                <div className="border-b p-2">
                  <ComboboxInput
                    showTrigger={false}
                    placeholder="搜索模型..."
                  />
                </div>
                <ComboboxEmpty>未找到匹配的模型</ComboboxEmpty>
                <ComboboxList>
                  {(item: import('@main/ipc-types').ModelDescriptor) => (
                    <ComboboxItem key={item.id} value={item}>
                      {item.label}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          )
          : session.modelId
            ? (
              <Button variant="ghost" size="xs" disabled className="text-muted-foreground/60">
                <BotIcon className="size-3" aria-hidden="true" />
                {session.modelId}
              </Button>
            )
            : null)}
    </>
  )
}

export const Route = createLazyFileRoute('/chat/$sessionId')({
  component: ChatSessionPage,
  pendingComponent: RouteLoadingFallback,
})

function ChatSessionPage() {
  const { sessionId } = Route.useParams()
  const { tearoff } = Route.useSearch()
  const { session: loaderSession, messages: initialMessageRows } = Route.useLoaderData()
  const queryClient = useQueryClient()
  const setSidebarCollapsed = useLayoutStore(s => s.setSidebarCollapsed)
  const [workspaceName, setWorkspaceName] = useState<string | null>(null)
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [shellGen, setShellGen] = useState(0)
  const { agents } = useAgents()

  // Session metadata: loader provides the initial value synchronously.
  // useQuery keeps it live (title updates, config changes) without an extra
  // round-trip on first render — the loader data seeds the cache.
  const { data: session } = useQuery({
    queryKey: ['chat-session', sessionId],
    queryFn: () => (ipc ? ipc.session.get(sessionId) : Promise.resolve(undefined)),
    initialData: loaderSession ?? undefined,
    enabled: !!sessionId,
  })

  const workspaceId = session?.workspaceId ?? null
  const sessionTitle = session?.title ?? null
  const isTerminalSession = session?.providerKind === 'cli-tui'
  const sessionAgent = useMemo(
    () => session?.agentId ? agents.find(a => a.id === session.agentId) ?? null : null,
    [session?.agentId, agents],
  )

  // Auto-collapse sidebar in tearoff windows
  useEffect(() => {
    if (tearoff) {
      setSidebarCollapsed(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    if (!isTerminalSession) {
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
  }, [sessionId, isTerminalSession, workspaceId, queryClient])

  // Engine forwards ACP title updates as chat:session-title with chatSessionId.
  useChatSessionTitle(sessionId, () => {
    queryClient.invalidateQueries({ queryKey: ['chat-session', sessionId] })
    if (workspaceId) {
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspaceId) })
    }
  })

  if (!session) {
    return (
      <AppLayout>
        <div className="flex h-full items-center justify-center">
          <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground/50" />
        </div>
      </AppLayout>
    )
  }

  const headerTitle = sessionAgent
    ? (
      <span className="flex items-center gap-1.5">
        <img src={sessionAgent.avatarUrl ?? undefined} alt="" className="size-4 rounded" crossOrigin="anonymous" />
        <span>{sessionTitle}</span>
      </span>
    )
    : sessionTitle

  return (
    <AppLayout
      title={headerTitle}
      workspace={workspaceName}
      hasAside
      hasPanel={!!(workspaceId && workspacePath)}
      gitBranch={<GitBranchControl workspacePath={workspacePath} />}
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
      {isTerminalSession
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
              />
            )}
          />
        )}
    </AppLayout>
  )
}
