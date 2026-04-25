// Input: ChatView from chat feature, TuiView from tui feature, ipc.chat, ipc.session, AppLayout, TanStack Router, RightAside
// Output: Chat session route — thin page that reads session from DB and renders ChatView or TuiView
// Position: Route page for /chat/$sessionId, data driven by main-process ChatEngine

import type { Session } from '@main/ipc-types'
import { AppHeader } from '@renderer/components/layout/app-header'
import { AppLayout } from '@renderer/components/layout/app-layout'
import { RightAside } from '@renderer/components/layout/right-aside'
import { Button } from '@renderer/components/ui/button'
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxPrimitive,
} from '@renderer/components/ui/combobox'
import { useAgentModels } from '@renderer/features/agent-runtime/use-agent-models'
import { useAgentProfiles } from '@renderer/features/agent-runtime/use-agent-profiles'
import { ChatView } from '@renderer/features/chat'
import { GitBranchControl } from '@renderer/features/git'
import { ShellView } from '@renderer/features/tui/shell-view'
import { TuiView } from '@renderer/features/tui/tui-view'
import { sessionsQueryKey } from '@renderer/features/workspace/use-session'
import { useWorkspaceFiles } from '@renderer/features/workspace/use-workspace-files'
import { ipc } from '@renderer/lib/ipc'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
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
  const { models, isLoading: isLoadingModels } = useAgentModels(session.agentProfileId ?? null)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(session.modelId ?? null)
  const queryClient = useQueryClient()

  const selectedProfile = profiles.find(p => p.id === session.agentProfileId) ?? null
  const selectedModel = models.find(m => m.id === selectedModelId) ?? models[0] ?? null

  const handleModelSelect = async (modelId: string) => {
    setSelectedModelId(modelId)
    await ipc?.session.updateConfig({ id: session.id, modelId, configSnapshot: session.configSnapshot ?? null })
    queryClient.invalidateQueries({ queryKey: ['chat-session', session.id] })
  }

  return (
    <>
      {/* Agent badge */}
      {selectedProfile && (
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

      {/* Model picker */}
      {isLoadingModels
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
              <ComboboxPrimitive.Trigger
                render={(
                  <Button variant="ghost" size="xs" className="text-muted-foreground/70 hover:text-foreground" />
                )}
              >
                <CpuIcon className="size-3" aria-hidden="true" />
                {selectedModel?.label ?? '默认模型'}
                <ChevronDownIcon aria-hidden="true" />
              </ComboboxPrimitive.Trigger>
              <ComboboxPopup aria-label="选择模型" className="min-w-60" side="left">
                <div className="border-b p-2">
                  <ComboboxInput
                    size="sm"
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
              </ComboboxPopup>
            </Combobox>
          )
          : session.modelId
            ? (
              <Button variant="ghost" size="xs" disabled className="text-muted-foreground/60">
                <BotIcon className="size-3" aria-hidden="true" />
                {session.modelId}
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
    return { session, messages }
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
  const { session: loaderSession, messages: initialMessageRows } = Route.useLoaderData()
  const queryClient = useQueryClient()
  const [workspaceName, setWorkspaceName] = useState<string | null>(null)
  const [workspacePath, setWorkspacePath] = useState<string | null>(null)
  const [shellGen, setShellGen] = useState(0)

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
      header={<AppHeader title={sessionTitle} workspace={workspaceName} hasAside hasPanel={!!(workspaceId && workspacePath)} trafficLight gitBranch={<GitBranchControl workspacePath={workspacePath} />} />}
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
