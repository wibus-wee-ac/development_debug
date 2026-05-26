/* eslint-disable react-refresh/only-export-components */

import { defineTab, useTabsContext } from '@cradle/tabs-next'
import { useQuery } from '@tanstack/react-query'
import { MessageCircleIcon } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef } from 'react'
import { z } from 'zod'

import { getSessionsByIdOptions } from '~/api-gen/@tanstack/react-query.gen'
import { getWorkspacesById } from '~/api-gen/sdk.gen'
import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import type { MentionItem } from '~/features/chat'
import { loadChatView } from '~/features/chat/chat-view-loader'
import { ComposerToolbar, useComposerState } from '~/features/composer-toolbar'
import { loadTerminalPanelView, preloadTerminalPanelView } from '~/features/tui/terminal-panel-view-loader'
import { loadTuiView, preloadTuiView } from '~/features/tui/tui-view-loader'
import { WorkspaceSchema } from '~/features/workspace/use-workspace'
import { useWorkspaceFiles } from '~/features/workspace/use-workspace-files'
import type { RuntimeKind } from '~/lib/types'

const ChatView = lazy(loadChatView)
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

export function ChatRuntimeView({
  sessionId,
  sessionProviderTargetId,
  runtimeKind,
  workspaceId,
}: {
  sessionId: string
  sessionProviderTargetId: string | null
  runtimeKind: RuntimeKind | undefined
  workspaceId: string | null
}) {
  const composerState = useComposerState({
    context: 'chat',
    boundProviderTargetId: sessionProviderTargetId ?? undefined,
    boundRuntimeKind: runtimeKind,
  })
  const { files: workspaceFiles } = useWorkspaceFiles(workspaceId)
  const availableFiles: MentionItem[] = useMemo(
    () => workspaceFiles.map(file => ({ type: file.type, name: file.name, path: file.path })),
    [workspaceFiles],
  )

  // Ref to communicate per-message overrides to ChatView's internal sendMessage
  const sendOverridesRef = useRef({
    providerTargetId: undefined as string | undefined,
    modelId: undefined as string | undefined,
    thinkingEffort: undefined as 'low' | 'medium' | 'high' | 'auto' | null | undefined,
  })
  // eslint-disable-next-line react-hooks/refs -- intentional: sync ref write during render for perf
  sendOverridesRef.current = {
    providerTargetId: composerState.selection.profileId ?? undefined,
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
        availableFiles={availableFiles}
        composerToolbar={composerToolbar}
        sendOverridesRef={sendOverridesRef}
        composerModel={composerState.effectiveModel}
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
