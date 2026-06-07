import { defineTab, useTabsContext } from '@cradle/tabs-next'
import { useQuery } from '@tanstack/react-query'
import { MessageCircleIcon } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo } from 'react'

import {
  getSessionsByIdOptions,
  getWorkspacesByIdOptions,
} from '~/api-gen/@tanstack/react-query.gen'
import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import { ChatSessionFrameHost } from '~/features/chat/session/chat-session-frame-host'
import { isElectron, nativeIpc } from '~/lib/electron'
import { useSessionLayoutStore } from '~/store/session-layout'

function loadTerminalPanelView() {
  return import('~/features/tui/bottom-terminal-panel').then(module => ({ default: module.BottomTerminalPanel }))
}

function loadTuiView() {
  return import('~/features/tui/tui-view').then(module => ({ default: module.TuiView }))
}

const BottomTerminalPanel = lazy(loadTerminalPanelView)
const TuiView = lazy(loadTuiView)

export const CHAT_TAB_FALLBACK_LABEL = 'Chat'

export function isGeneratedChatLabel(label: string, sessionId: string): boolean {
  return label === `Chat: ${sessionId.slice(0, 6)}`
}

function ChatTabLayoutSlots({
  sessionId,
  workspaceId,
  workspacePath,
}: {
  sessionId: string
  workspaceId: string | null
  workspacePath: string | null
}) {
  const hasWorkspace = !!(workspaceId && workspacePath)

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
  })
  const sessionProviderTargetId = session?.providerTargetId ?? null
  const sessionModelId = session?.modelId ?? null

  const isCliTui = session?.runtimeKind === 'cli-tui'

  useEffect(() => {
    if (typeof session?.archivedAt !== 'number') {
      return
    }

    const { tabs, closeTab } = store.getState()
    for (const tab of tabs) {
      if (tab.type === 'chat' && tab.params.sessionId === sessionId) {
        closeTab(tab.id)
      }
    }

    if (isElectron) {
      void nativeIpc?.window.closeSession(sessionId).catch(() => {})
    }
  }, [session?.archivedAt, sessionId, store])

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
  const agentId = session?.agentId ?? null
  const activeSession = useMemo(() => ({
    sessionId,
    sessionProviderTargetId,
    sessionModelId,
    runtimeKind: session?.runtimeKind,
    workspaceId,
    agentId,
  }), [agentId, session?.runtimeKind, sessionId, sessionModelId, sessionProviderTargetId, workspaceId])

  // Fetch workspace details — derive path/name from query data (not side-effects)
  const { data: workspace } = useQuery({
    ...getWorkspacesByIdOptions({ path: { id: workspaceId! } }),
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
      void loadTerminalPanelView()
    }
  }, [workspacePath])

  useEffect(() => {
    if (isCliTui) {
      void loadTuiView()
    }
  }, [isCliTui])

  if (isCliTui) {
    return (
      <>
        <ChatTabLayoutSlots sessionId={sessionId} workspaceId={workspaceId} workspacePath={workspacePath} />
        <Suspense fallback={null}>
          <TuiView sessionId={sessionId} />
        </Suspense>
      </>
    )
  }

  return (
    <>
      <ChatTabLayoutSlots sessionId={sessionId} workspaceId={workspaceId} workspacePath={workspacePath} />
      <ChatSessionFrameHost activeSession={activeSession} />
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
