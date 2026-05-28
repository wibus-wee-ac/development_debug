// Output: Chat session runtime view shared by tab routes and tear-off windows.
// Input: Session metadata, runtime kind, and workspace ownership.
// Position: Chat-owned rendering boundary independent of app shell and tab registry.

import { lazy, Suspense, useMemo, useRef } from 'react'

import type { MentionItem } from '~/features/chat'
import { loadChatView } from '~/features/chat/chat-view-loader'
import { ComposerToolbar, useComposerState } from '~/features/composer-toolbar'
import { useWorkspaceFiles } from '~/features/workspace/use-workspace-files'
import type { RuntimeKind } from '~/lib/types'

const ChatView = lazy(loadChatView)

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
      <ChatView
        key={sessionId}
        sessionId={sessionId}
        runtimeKind={runtimeKind}
        availableFiles={availableFiles}
        composerToolbar={composerToolbar}
        sendOverridesRef={sendOverridesRef}
        composerModel={composerState.effectiveModel}
      />
    </Suspense>
  )
}
