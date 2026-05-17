/* eslint-disable react-refresh/only-export-components */
// Input: defineTab from @cradle/tabs-next, ChatView/TuiView components, HTTP snapshot rows, layout slots context
// Output: chat tab definition with session snapshot loader and per-tab layout (aside + shell panel)
// Position: Tab type for chat sessions; forks to TuiView for cli-tui provider sessions

import { defineTab, useTabsContext } from '@cradle/tabs-next'
import { useQuery } from '@tanstack/react-query'
import { LoaderCircleIcon, MessageCircleIcon } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useReducer, useRef } from 'react'

import { getSessionsByIdOptions } from '~/api-gen/@tanstack/react-query.gen'
import { getProfilesById, getWorkspacesById } from '~/api-gen/sdk.gen'
import { RightAside } from '~/components/layout/right-aside'
import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import type { ChatSessionMessageRow } from '~/features/chat/use-chat-session'
import { ComposerToolbar, useComposerState } from '~/features/composer-toolbar'
import { ShellView } from '~/features/tui/shell-view'
import { TuiView } from '~/features/tui/tui-view'
import { getServerUrl } from '~/lib/electron'
import type { AgentProfile, Workspace } from '~/lib/types'
import { useLayoutStore } from '~/store/layout'

const ChatView = lazy(() => import('~/features/chat/chat-view').then(m => ({ default: m.ChatView })))

function ChatTabLayoutSlots({
  sessionId,
  workspaceId,
  workspacePath,
}: {
  sessionId: string
  workspaceId: string | null
  workspacePath: string | null
}) {
  const [shellGen, bumpShellGen] = useReducer((value: number) => value + 1, 0)
  const hasWorkspace = !!(workspaceId && workspacePath)
  const bottomPanelOpen = useLayoutStore(s => s.bottomPanelOpen)
  const closeBottomPanel = useLayoutStore(s => s.setBottomPanelOpen)

  const aside = useMemo(
    () => (
      <RightAside
        workspaceId={workspaceId}
        workspacePath={workspacePath}
        sessionId={sessionId}
      />
    ),
    [workspaceId, workspacePath, sessionId],
  )

  const panel = useMemo(
    () => hasWorkspace
      ? (
        <ShellView
          key={`${sessionId}:${shellGen}`}
          ptyId={`shell:${sessionId}:${shellGen}`}
          cwd={workspacePath!}
          active={bottomPanelOpen}
          onExited={() => {
            closeBottomPanel(false)
            bumpShellGen()
          }}
        />
      )
      : undefined,
    [bottomPanelOpen, closeBottomPanel, hasWorkspace, workspacePath, sessionId, shellGen],
  )

  useRegisterLayoutSlots(sessionId, useMemo(() => ({
    hasAside: true,
    hasPanel: hasWorkspace,
    aside,
    panel,
  }), [hasWorkspace, aside, panel]))

  return null
}

function ChatTabContent({ params, loaderData }: { params: { sessionId: string }, loaderData?: ChatSessionMessageRow[] }) {
  const { sessionId } = params
  const { store } = useTabsContext()

  // Fetch session metadata to get workspaceId → workspacePath for aside/panel
  const { data: session } = useQuery({
    ...getSessionsByIdOptions({ path: { id: sessionId } }),
    enabled: !!sessionId,
    select: data => data
      ? {
          id: data.id,
          title: typeof data.title === 'string' ? data.title : null,
          workspaceId: typeof data.workspaceId === 'string' ? data.workspaceId : null,
          agentProfileId: typeof data.agentProfileId === 'string' ? data.agentProfileId : null,
          runtimeKind: data.runtimeKind,
        }
      : undefined,
  })
  const sessionAgentProfileId = session?.agentProfileId ?? null

  // Fetch agent profile to determine rendering mode (cli-tui vs chat)
  const { data: _agentProfile } = useQuery({
    queryKey: ['agent-profile', sessionAgentProfileId],
    queryFn: async () => {
      const { data } = await getProfilesById({ path: { id: sessionAgentProfileId! } })
      return data as AgentProfile | undefined
    },
    enabled: !!sessionAgentProfileId,
    staleTime: 60_000,
  })

  const isCliTui = session?.runtimeKind === 'cli-tui'

  const composerState = useComposerState({
    context: 'chat',
    boundProfileId: sessionAgentProfileId ?? undefined,
    boundRuntimeKind: session?.runtimeKind ?? undefined,
  })

  // Ref to communicate per-message overrides to ChatView's internal sendMessage
  const sendOverridesRef = useRef({ modelId: undefined as string | undefined, thinkingEffort: undefined as 'low' | 'medium' | 'high' | 'auto' | null | undefined })
  // eslint-disable-next-line react-hooks/refs -- intentional: sync ref write during render for perf
  sendOverridesRef.current = {
    modelId: composerState.selection.modelId ?? undefined,
    thinkingEffort: composerState.selection.thinkingEffort ?? undefined,
  }

  const composerToolbar = useMemo(() => (
    <ComposerToolbar context="chat" state={composerState} />
  ), [composerState])

  // Update tab label to session title when loaded
  useEffect(() => {
    if (session?.title) {
      const activeTab = store.getState().tabs.find(t => t.params.sessionId === sessionId)
      if (activeTab) {
        store.getState().updateTabLabel(activeTab.id, session.title)
      }
    }
  }, [session?.title, sessionId, store])

  const workspaceId = session?.workspaceId ?? null

  // Fetch workspace details — derive path/name from query data (not side-effects)
  const { data: workspace } = useQuery({
    queryKey: ['workspace-detail', workspaceId],
    queryFn: async () => {
      const { data } = await getWorkspacesById({ path: { id: workspaceId! } })
      return data as Workspace | undefined
    },
    enabled: !!workspaceId,
    staleTime: 60_000,
  })

  const workspacePath = workspace?.path ?? null

  if (isCliTui) {
    return (
      <>
        <ChatTabLayoutSlots sessionId={sessionId} workspaceId={workspaceId} workspacePath={workspacePath} />
        <TuiView sessionId={sessionId} />
      </>
    )
  }

  return (
    <>
      <ChatTabLayoutSlots sessionId={sessionId} workspaceId={workspaceId} workspacePath={workspacePath} />
      <Suspense fallback={null}>
        {/* {hasWorkspace && (
          <div className="flex items-center gap-2 border-b border-border/50 px-4 py-1">
            <GitBranchControl workspaceId={workspaceId} />
          </div>
        )} */}
        <ChatView
          key={sessionId}
          sessionId={sessionId}
          initialSnapshotRows={loaderData}
          composerToolbar={composerToolbar}
          sendOverridesRef={sendOverridesRef}
        />
      </Suspense>
    </>
  )
}

export const chatTab = defineTab({
  type: 'chat' as const,
  icon: MessageCircleIcon,
  label: (params: { sessionId: string }) => `Chat: ${params.sessionId.slice(0, 6)}`,
  component: ChatTabContent,
  loader: async (params: { sessionId: string }) => {
    try {
      const res = await fetch(`${getServerUrl()}/chat/sessions/${params.sessionId}/messages`)
      if (!res.ok) {
        return []
      }
      return (await res.json()) as ChatSessionMessageRow[]
    }
    catch {
      return []
    }
  },
  loaderFallback: (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <LoaderCircleIcon style={{ width: 16, height: 16, animation: 'spin 1s linear infinite', opacity: 0.4 }} />
    </div>
  ),
  serialize: params => params.sessionId,
  deserialize: path => path ? { sessionId: path } : null,
})
