/* eslint-disable react-refresh/only-export-components */

import { defineTab, useTabsContext } from '@cradle/tabs-next'
import { useQuery } from '@tanstack/react-query'
import { MessageCircleIcon } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useReducer, useRef } from 'react'

import { getSessionsByIdOptions } from '~/api-gen/@tanstack/react-query.gen'
import { getProfilesById, getWorkspacesById } from '~/api-gen/sdk.gen'
import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import { ComposerToolbar, useComposerState } from '~/features/composer-toolbar'
import { ShellView } from '~/features/tui/shell-view'
import { TuiView } from '~/features/tui/tui-view'
import type { AgentProfile, RuntimeKind, Workspace } from '~/lib/types'
import { useLayoutStore } from '~/store/layout'

const ChatView = lazy(() => import('~/features/chat/chat-view').then(m => ({ default: m.ChatView })))

export const CHAT_TAB_FALLBACK_LABEL = 'Chat'

const SUPPORTED_RUNTIME_KINDS: readonly RuntimeKind[] = ['standard', 'claude-agent', 'codex', 'jar-core', 'acp-chat', 'cli-tui']

export function isGeneratedChatLabel(label: string, sessionId: string): boolean {
  return label === `Chat: ${sessionId.slice(0, 6)}`
}

export function parseRuntimeKind(value: unknown): RuntimeKind | undefined {
  return typeof value === 'string' && (SUPPORTED_RUNTIME_KINDS as readonly string[]).includes(value)
    ? value as RuntimeKind
    : undefined
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
  const [shellGen, bumpShellGen] = useReducer((value: number) => value + 1, 0)
  const hasWorkspace = !!(workspaceId && workspacePath)
  const bottomPanelOpen = useLayoutStore(s => s.bottomPanelOpen)
  const closeBottomPanel = useLayoutStore(s => s.setBottomPanelOpen)

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
    hasPanel: hasWorkspace,
    panel,
  }), [hasWorkspace, panel]))

  return null
}

export function ChatRuntimeView({
  sessionId,
  sessionAgentProfileId,
  runtimeKind,
}: {
  sessionId: string
  sessionAgentProfileId: string | null
  runtimeKind: RuntimeKind | undefined
}) {
  const composerState = useComposerState({
    context: 'chat',
    boundProfileId: sessionAgentProfileId ?? undefined,
    boundRuntimeKind: runtimeKind,
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

  return (
    <Suspense fallback={null}>
      {/* {hasWorkspace && (
        <div className="flex items-center gap-2 border-b border-border/50 px-4 py-1">
          <GitBranchControl workspaceId={workspaceId} />
        </div>
      )} */}
      <ChatView
        key={sessionId}
        sessionId={sessionId}
        composerToolbar={composerToolbar}
        sendOverridesRef={sendOverridesRef}
      />
    </Suspense>
  )
}

function ChatTabContent({ params }: { params: { sessionId: string } }) {
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
          runtimeKind: parseRuntimeKind(data.runtimeKind),
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
      <ChatRuntimeView
        sessionId={sessionId}
        sessionAgentProfileId={sessionAgentProfileId}
        runtimeKind={session?.runtimeKind}
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
