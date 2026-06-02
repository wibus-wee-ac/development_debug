// Output: Chat session runtime view shared by tab routes and tear-off windows.
// Input: Session metadata, runtime kind, and workspace ownership.
// Position: Chat-owned rendering boundary independent of app shell and tab registry.

import { lazy, Suspense, useCallback, useMemo, useRef } from 'react'

import { getSkills } from '~/api-gen/sdk.gen'
import type { MentionItem } from '~/features/chat'
import { loadChatView } from '~/features/chat/chat-view-loader'
import type { SkillMentionItem } from '~/features/chat/skill-mention-panel'
import { ComposerToolbar, useComposerState } from '~/features/composer-toolbar'
import { searchWorkspaceFiles } from '~/features/workspace/use-workspace-files'
import type { RuntimeKind, SkillInventoryEntry } from '~/lib/types'

const ChatView = lazy(loadChatView)

export function ChatRuntimeView({
  sessionId,
  sessionProviderTargetId,
  runtimeKind,
  workspaceId,
  agentId,
}: {
  sessionId: string
  sessionProviderTargetId: string | null
  runtimeKind: RuntimeKind | undefined
  workspaceId: string | null
  agentId: string | null
}) {
  const composerState = useComposerState({
    context: 'chat',
    boundProviderTargetId: sessionProviderTargetId ?? undefined,
    boundRuntimeKind: runtimeKind,
  })
  const searchFiles = useCallback(async (query: string, signal?: AbortSignal): Promise<MentionItem[]> => {
    if (!workspaceId) {
      return []
    }
    return searchWorkspaceFiles({ workspaceId, query, limit: 30, signal })
  }, [workspaceId])
  const searchSkills = useCallback(async (_query: string, signal?: AbortSignal): Promise<SkillMentionItem[]> => {
    const { data } = await getSkills({
      query: {
        workspaceId: workspaceId ?? undefined,
        agentId: agentId ?? undefined,
      },
      signal,
    })
    return ((data ?? []) as SkillInventoryEntry[])
      .filter(skill => skill.active)
      .map(skill => ({
        name: skill.name,
        description: skill.description,
        scope: skill.scope,
        skillDir: skill.skillDir,
      }))
  }, [agentId, workspaceId])

  const sendOverridesRef = useRef({
    providerTargetId: undefined as string | undefined,
    modelId: undefined as string | undefined,
    thinkingEffort: undefined as 'low' | 'medium' | 'high' | 'auto' | null | undefined,
  })
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
        workspaceId={workspaceId}
        searchFiles={searchFiles}
        searchSkills={searchSkills}
        composerToolbar={composerToolbar}
        sendOverridesRef={sendOverridesRef}
        composerModel={composerState.effectiveModel}
      />
    </Suspense>
  )
}
