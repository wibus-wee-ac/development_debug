import { useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useCallback, useLayoutEffect, useMemo, useRef } from 'react'

import { getSessionsByIdQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { getSkills, patchSessionsById } from '~/api-gen/sdk.gen'
import type { MentionItem } from '~/features/chat'
import type { SkillMentionItem } from '~/features/chat/skill-mention-panel'
import { ComposerToolbar, useComposerState } from '~/features/composer-toolbar'
import { updateSessionInSessionLists } from '~/features/workspace/use-session'
import { searchWorkspaceFiles } from '~/features/workspace/use-workspace-files'
import type { RuntimeKind, SkillInventoryEntry } from '~/lib/types'

const ChatView = lazy(() => import('./chat-view').then(module => ({ default: module.ChatView })))

export function ChatRuntimeView({
  sessionId,
  sessionProviderTargetId,
  sessionModelId,
  runtimeKind,
  workspaceId,
  agentId,
  onSideChatCreated,
}: {
  sessionId: string
  sessionProviderTargetId: string | null
  sessionModelId: string | null
  runtimeKind: RuntimeKind | undefined
  workspaceId: string | null
  agentId: string | null
  onSideChatCreated?: (sessionId: string) => void
}) {
  const queryClient = useQueryClient()
  const composerState = useComposerState({
    context: 'chat',
    boundAgentId: agentId,
    boundProviderTargetId: sessionProviderTargetId ?? undefined,
    boundModelId: sessionModelId,
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
    const activeSkills: SkillMentionItem[] = []
    for (const skill of (data ?? []) as SkillInventoryEntry[]) {
      if (!skill.active) {
        continue
      }
      activeSkills.push({
        name: skill.name,
        description: skill.description,
        scope: skill.scope,
        skillDir: skill.skillDir,
      })
    }
    return activeSkills
  }, [agentId, workspaceId])

  const sendOverridesRef = useRef({
    providerTargetId: undefined as string | undefined,
    modelId: undefined as string | undefined,
    thinkingEffort: undefined as 'low' | 'medium' | 'high' | 'xhigh' | 'auto' | null | undefined,
  })
  useLayoutEffect(() => {
    sendOverridesRef.current = {
      providerTargetId: composerState.selection.profileId ?? undefined,
      modelId: composerState.selection.modelId ?? undefined,
      thinkingEffort: composerState.selection.thinkingEffort ?? undefined,
    }
  }, [composerState.selection.modelId, composerState.selection.profileId, composerState.selection.thinkingEffort])

  const persistSessionProviderModel = useCallback(async (body: {
    providerTargetId?: string
    modelId?: string | null
  }) => {
    const previousSessionKey = getSessionsByIdQueryKey({ path: { id: sessionId } })
    const previousSession = queryClient.getQueryData(previousSessionKey)
    const optimisticPatch = {
      ...(body.providerTargetId !== undefined ? { providerTargetId: body.providerTargetId } : {}),
      ...(body.modelId !== undefined ? { modelId: body.modelId } : {}),
    }

    queryClient.setQueryData(previousSessionKey, current =>
      current && typeof current === 'object'
        ? { ...current, ...optimisticPatch }
        : current)
    updateSessionInSessionLists(queryClient, { id: sessionId, ...optimisticPatch })

    try {
      const { data } = await patchSessionsById({
        path: { id: sessionId },
        body,
      })
      if (data) {
        queryClient.setQueryData(previousSessionKey, data)
        updateSessionInSessionLists(queryClient, data)
      }
    }
    catch {
      queryClient.setQueryData(previousSessionKey, previousSession)
      void queryClient.invalidateQueries({ queryKey: previousSessionKey })
      void queryClient.invalidateQueries({ predicate: query =>
        query.queryKey[0] !== null
        && typeof query.queryKey[0] === 'object'
        && (query.queryKey[0] as { _id?: unknown })._id === 'getSessions' })
    }
  }, [queryClient, sessionId])

  const sessionComposerState = useMemo(() => ({
    ...composerState,
    setProfileId: (id: string) => {
      composerState.setProfileId(id)
      const nextModelId = composerState.modelsByProfileId[id]?.[0]?.id ?? null
      void persistSessionProviderModel({ providerTargetId: id, modelId: nextModelId })
    },
    setModelId: (id: string, profileId?: string) => {
      composerState.setModelId(id, profileId)
      void persistSessionProviderModel({
        providerTargetId: profileId ?? composerState.selection.profileId ?? undefined,
        modelId: id,
      })
    },
  }), [composerState, persistSessionProviderModel])

  const composerToolbar = useMemo(() => (
    <ComposerToolbar context="chat" state={sessionComposerState} />
  ), [sessionComposerState])

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
        composerModel={sessionComposerState.effectiveModel}
        onSideChatCreated={onSideChatCreated}
      />
    </Suspense>
  )
}
