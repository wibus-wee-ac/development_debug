/* eslint-disable react-refresh/only-export-components */

import { defineTab, useTabsContext } from '@cradle/tabs-next'
import { useQuery } from '@tanstack/react-query'
import { MessageCircleIcon } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo } from 'react'
import { z } from 'zod'

import { getSessionsByIdOptions } from '~/api-gen/@tanstack/react-query.gen'
import { getWorkspacesById } from '~/api-gen/sdk.gen'
import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import { ChatRuntimeView } from '~/features/chat/chat-runtime-view'
import { loadTerminalPanelView, preloadTerminalPanelView } from '~/features/tui/terminal-panel-view-loader'
import { loadTuiView, preloadTuiView } from '~/features/tui/tui-view-loader'
import { WorkspaceSchema } from '~/features/workspace/use-workspace'
import { useSessionLayoutStore } from '~/store/session-layout'

const BottomTerminalPanel = lazy(loadTerminalPanelView)
const TuiView = lazy(loadTuiView)

export const CHAT_TAB_FALLBACK_LABEL = 'Chat'

const RuntimeKindSchema = z.enum(['standard', 'claude-agent', 'codex', 'jar-core', 'acp-chat', 'cli-tui'])
const ChatSessionMetadataSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  workspaceId: z.string().nullable(),
  providerTargetId: z.string().nullable(),
  runtimeKind: RuntimeKindSchema,
}).passthrough()

export function isGeneratedChatLabel(label: string, sessionId: string): boolean {
  return label === `Chat: ${sessionId.slice(0, 6)}`
}

function ChatTabLayoutSlots({
  sessionId,
  workspaceId,
  workspacePath,
  enabled,
}: {
  sessionId: string
  workspaceId: string | null
  workspacePath: string | null
  enabled: boolean
}) {
  const hasWorkspace = enabled && !!(workspaceId && workspacePath)

  const panel = useMemo(
    () => hasWorkspace
      ? (
          <Suspense fallback={null}>
            <BottomTerminalPanel
              ownerId={`chat:${sessionId}`}
              cwd={workspacePath!}
            />
          </Suspense>
        )
      : undefined,
    [hasWorkspace, workspacePath, sessionId],
  )

  useRegisterLayoutSlots(sessionId, useMemo(() => ({
    asideSessionId: sessionId,
    asideWorkspaceId: hasWorkspace ? workspaceId : null,
    hasAside: true,
    hasBrowserPanel: hasWorkspace,
    hasPanel: hasWorkspace,
    panel,
  }), [hasWorkspace, panel, sessionId, workspaceId]))

  return null
}

function ChatTabContent({ params }: { params: { sessionId: string } }) {
  const { sessionId } = params
  const { store } = useTabsContext()

  // Fetch session metadata to get workspaceId → workspacePath for aside/panel
  const { data: session } = useQuery({
    ...getSessionsByIdOptions({ path: { id: sessionId } }),
    enabled: !!sessionId,
    select: data => data ? ChatSessionMetadataSchema.parse(data) : undefined,
  })
  const sessionProviderTargetId = session?.providerTargetId ?? null

  const isCliTui = session?.runtimeKind === 'cli-tui'

  // Replace legacy session-id labels before metadata finishes loading.
  useEffect(() => {
    const tabs = store.getState().tabs.filter(
      tab =>
        tab.type === 'chat'
        && tab.params.sessionId === sessionId
        && isGeneratedChatLabel(tab.label, sessionId),
    )

    for (const tab of tabs) {
      store.getState().updateTabLabel(tab.id, CHAT_TAB_FALLBACK_LABEL)
    }
  }, [sessionId, store])

  // Update tab label to session title when loaded.
  useEffect(() => {
    if (!session?.title) {
      return
    }

    const tabs = store.getState().tabs.filter(
      tab => tab.type === 'chat' && tab.params.sessionId === sessionId && tab.label !== session.title,
    )

    for (const tab of tabs) {
      store.getState().updateTabLabel(tab.id, session.title)
    }
  }, [session?.title, sessionId, store])

  const workspaceId = session?.workspaceId ?? null

  // Fetch workspace details — derive path/name from query data (not side-effects)
  const { data: workspace } = useQuery({
    queryKey: ['workspace-detail', workspaceId],
    queryFn: async () => {
      const { data } = await getWorkspacesById({ path: { id: workspaceId! } })
      return WorkspaceSchema.parse(data)
    },
    enabled: !!workspaceId,
    staleTime: 60_000,
  })

  const workspacePath = workspace?.path ?? null

  useEffect(() => {
    if (!session) {
      return
    }
    useSessionLayoutStore.getState().upsertSession({
      sessionId,
      sessionTitle: session.title,
      workspaceId,
      workspacePath,
      runtimeKind: session.runtimeKind,
    })
  }, [session, sessionId, workspaceId, workspacePath])

  useEffect(() => {
    if (workspacePath) {
      preloadTerminalPanelView()
    }
  }, [workspacePath])

  useEffect(() => {
    if (isCliTui) {
      preloadTuiView()
    }
  }, [isCliTui])

  if (isCliTui) {
    return (
      <>
        <ChatTabLayoutSlots sessionId={sessionId} workspaceId={workspaceId} workspacePath={workspacePath} enabled={false} />
        <Suspense fallback={null}>
          <TuiView sessionId={sessionId} />
        </Suspense>
      </>
    )
  }

  return (
    <>
      <ChatTabLayoutSlots sessionId={sessionId} workspaceId={workspaceId} workspacePath={workspacePath} enabled />
      <ChatRuntimeView
        sessionId={sessionId}
        sessionProviderTargetId={sessionProviderTargetId}
        runtimeKind={session?.runtimeKind}
        workspaceId={workspaceId}
      />
    </>
  )
}

export const chatTab = defineTab({
  type: 'chat' as const,
  icon: MessageCircleIcon,
  label: CHAT_TAB_FALLBACK_LABEL,
  component: ChatTabContent,
  serialize: params => params.sessionId,
  deserialize: path => path ? { sessionId: path } : null,
})
