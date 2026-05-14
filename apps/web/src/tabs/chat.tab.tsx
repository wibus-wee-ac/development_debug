/* eslint-disable react-refresh/only-export-components */
// Input: defineTab from @cradle/tabs, ChatView/TuiView components, HTTP timeline, layout slots context
// Output: chat tab definition with session message loader and per-tab layout (aside + shell panel)
// Position: Tab type for chat sessions; forks to TuiView for cli-tui provider sessions

import { defineTab, useTabsContext } from '@cradle/tabs'
import { useQuery } from '@tanstack/react-query'
import { LoaderCircleIcon, MessageCircleIcon } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'

import { getProfilesById, getSessionsById, getWorkspacesById } from '~/api-gen/sdk.gen'
import { RightAside } from '~/components/layout/right-aside'
import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import type { ChatTimelineGroupRow } from '~/features/chat/use-chat-session'
import { GitBranchControl } from '~/features/git'
import { ShellView } from '~/features/tui/shell-view'
import { TuiView } from '~/features/tui/tui-view'
import { getServerUrl } from '~/lib/electron'
import type { AgentProfile, Session, Workspace } from '~/lib/types'

const ChatView = lazy(() => import('~/features/chat/chat-view').then(m => ({ default: m.ChatView })))

function ChatTabContent({ params, loaderData }: { params: { sessionId: string }, loaderData?: ChatTimelineGroupRow[] }) {
  const { sessionId } = params
  const { store } = useTabsContext()
  const [shellGen, setShellGen] = useState(0)

  // Fetch session metadata to get workspaceId → workspacePath for aside/panel
  const { data: session } = useQuery({
    queryKey: ['chat-session', sessionId],
    queryFn: async () => {
      const { data } = await getSessionsById({ path: { id: sessionId } })
      return data as Session | undefined
    },
    enabled: !!sessionId,
  })

  // Fetch agent profile to determine rendering mode (cli-tui vs chat)
  const { data: agentProfile } = useQuery({
    queryKey: ['agent-profile', session?.agentProfileId],
    queryFn: async () => {
      const { data } = await getProfilesById({ path: { id: session!.agentProfileId } })
      return data as AgentProfile | undefined
    },
    enabled: !!session?.agentProfileId,
    staleTime: 60_000,
  })

  const isCliTui = agentProfile?.providerKind === 'cli-tui'

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

  const hasWorkspace = !!(workspaceId && workspacePath)

  // Memoize each slot so register() can bail out on reference equality
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
          onExited={() => setShellGen(g => g + 1)}
        />
      )
      : undefined,

    [hasWorkspace, workspacePath, sessionId, shellGen],
  )

  // cli-tui sessions: full-screen terminal but still expose aside/panel
  useRegisterLayoutSlots(sessionId, useMemo(() => ({
    hasAside: true,
    hasPanel: hasWorkspace,
    aside,
    panel,
  }), [hasWorkspace, aside, panel]))

  if (isCliTui) {
    return <TuiView sessionId={sessionId} />
  }

  return (
    <Suspense fallback={null}>
      {hasWorkspace && (
        <div className="flex items-center gap-2 border-b border-border/50 px-4 py-1">
          <GitBranchControl workspaceId={workspaceId} />
        </div>
      )}
      <ChatView key={sessionId} sessionId={sessionId} initialTimelineGroups={loaderData} />
    </Suspense>
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
      return (await res.json()) as ChatTimelineGroupRow[]
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
