import { useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { getSessionsByIdQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { getSkills, patchSessionsById } from '~/api-gen/sdk.gen'
import type { MentionItem } from '~/features/chat'
import type { SkillMentionItem } from '~/features/chat/skill-mention-panel'
import { ComposerToolbar, useComposerState } from '~/features/composer-toolbar'
import { updateSessionInSessionLists } from '~/features/workspace/use-session'
import { searchWorkspaceFiles } from '~/features/workspace/use-workspace-files'
import type { RuntimeKind, SkillInventoryEntry } from '~/lib/types'

import type { SendMessageOptions } from './use-chat-session'

const ChatView = lazy(() => import('./chat-view').then(module => ({ default: module.ChatView })))

type SessionProviderModelPatch
  = | { providerTargetId: string, modelId: string }
    | { modelId: string | null }

interface SessionProviderModelSaveState {
  queue: Promise<void>
  revision: number
  confirmedSession: unknown
}

export function ChatRuntimeView({
  sessionId,
  sessionProviderTargetId,
  sessionModelId,
  runtimeKind,
  workspaceId,
  agentId,
}: {
  sessionId: string
  sessionProviderTargetId: string | null
  sessionModelId: string | null
  runtimeKind: RuntimeKind | undefined
  workspaceId: string | null
  agentId: string | null
}) {
  const queryClient = useQueryClient()
  const composerResetKey = [
    sessionId,
    agentId ?? '',
    sessionProviderTargetId ?? '',
    sessionModelId ?? '',
    runtimeKind ?? '',
  ].join(':')
  const composerState = useComposerState({
    context: 'chat',
    boundAgentId: agentId,
    boundProviderTargetId: sessionProviderTargetId ?? undefined,
    boundModelId: sessionModelId,
    boundRuntimeKind: runtimeKind,
    resetKey: composerResetKey,
  })
  const [pendingProviderTargetId, setPendingProviderTargetId] = useState<string | null>(null)
  const composerSelectionPending = pendingProviderTargetId !== null
    && composerState.selection.profileId === pendingProviderTargetId
    && !composerState.selection.modelId
  const providerModelSaveStateRef = useRef<SessionProviderModelSaveState | null>(null)
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
    thinkingEffort: undefined as SendMessageOptions['thinkingEffort'],
  })
  useLayoutEffect(() => {
    const hasPendingProviderSelection = pendingProviderTargetId !== null
      && composerState.selection.profileId === pendingProviderTargetId
      && !composerState.selection.modelId
    sendOverridesRef.current = {
      providerTargetId: hasPendingProviderSelection ? undefined : composerState.selection.profileId ?? undefined,
      modelId: composerState.selection.modelId ?? undefined,
      thinkingEffort: composerState.selection.thinkingEffort ?? undefined,
    }
  }, [composerState.selection.modelId, composerState.selection.profileId, composerState.selection.thinkingEffort, pendingProviderTargetId])

  const persistSessionProviderModel = useCallback((body: SessionProviderModelPatch) => {
    const targetSessionId = sessionId
    const previousSessionKey = getSessionsByIdQueryKey({ path: { id: targetSessionId } })
    const previousSession = queryClient.getQueryData(previousSessionKey)
    let saveState = providerModelSaveStateRef.current
    if (!saveState) {
      saveState = {
        queue: Promise.resolve(),
        revision: 0,
        confirmedSession: previousSession,
      }
      providerModelSaveStateRef.current = saveState
    }
    const revision = saveState.revision + 1
    saveState.revision = revision
    const optimisticPatch = {
      ...('providerTargetId' in body ? { providerTargetId: body.providerTargetId } : {}),
      ...(body.modelId !== undefined ? { modelId: body.modelId } : {}),
    }

    queryClient.setQueryData(previousSessionKey, current =>
      current && typeof current === 'object'
        ? { ...current, ...optimisticPatch }
        : current)
    updateSessionInSessionLists(queryClient, { id: targetSessionId, ...optimisticPatch })

    const saveTask = saveState.queue
      .catch(() => undefined)
      .then(async () => {
        try {
          const { data } = await patchSessionsById({
            path: { id: targetSessionId },
            body,
          })
          const currentSaveState = providerModelSaveStateRef.current
          if (data && currentSaveState) {
            currentSaveState.confirmedSession = data
          }
          if (data && currentSaveState?.revision === revision) {
            queryClient.setQueryData(previousSessionKey, data)
            updateSessionInSessionLists(queryClient, data)
          }
        }
        catch {
          const currentSaveState = providerModelSaveStateRef.current
          if (currentSaveState?.revision === revision) {
            queryClient.setQueryData(previousSessionKey, currentSaveState.confirmedSession ?? previousSession)
            void queryClient.invalidateQueries({ queryKey: previousSessionKey })
            void queryClient.invalidateQueries({ predicate: query =>
              query.queryKey[0] !== null
              && typeof query.queryKey[0] === 'object'
              && (query.queryKey[0] as { _id?: unknown })._id === 'getSessions' })
          }
        }
      })

    saveState.queue = saveTask.catch(() => undefined)
    return saveTask
  }, [queryClient, sessionId])

  useEffect(() => {
    if (!pendingProviderTargetId) {
      return
    }
    if (composerState.selection.profileId !== pendingProviderTargetId) {
      setPendingProviderTargetId(null)
      return
    }
    const nextModels = composerState.modelsByProfileId[pendingProviderTargetId] ?? []
    if (nextModels.length === 0) {
      if (composerState.successfulProfileIds.has(pendingProviderTargetId)) {
        composerState.resetManualSelection()
        setPendingProviderTargetId(null)
      }
      return
    }
    const nextModelId = nextModels[0]!.id
    composerState.setModelId(nextModelId, pendingProviderTargetId)
    void persistSessionProviderModel({ providerTargetId: pendingProviderTargetId, modelId: nextModelId })
    setPendingProviderTargetId(null)
  }, [
    composerState.modelsByProfileId,
    composerState.selection.profileId,
    composerState.setModelId,
    composerState.resetManualSelection,
    composerState.successfulProfileIds,
    pendingProviderTargetId,
    persistSessionProviderModel,
  ])

  const sessionComposerState = useMemo(() => ({
    ...composerState,
    setProfileId: (id: string) => {
      composerState.setProfileId(id)
      composerState.requestProfileModels(id)
      const nextModels = composerState.modelsByProfileId[id] ?? []
      const nextModelId = nextModels[0]?.id ?? null
      if (!nextModelId) {
        setPendingProviderTargetId(id)
        return
      }
      composerState.setModelId(nextModelId, id)
      setPendingProviderTargetId(null)
      void persistSessionProviderModel({ providerTargetId: id, modelId: nextModelId })
    },
    setModelId: (id: string, profileId?: string) => {
      composerState.setModelId(id, profileId)
      setPendingProviderTargetId(null)
      const resolvedProfileId = profileId ?? composerState.selection.profileId
      void (resolvedProfileId
        ? persistSessionProviderModel({ providerTargetId: resolvedProfileId, modelId: id })
        : persistSessionProviderModel({ modelId: id }))
    },
  }), [composerState, persistSessionProviderModel])

  const composerToolbar = useMemo(() => (
    <ComposerToolbar context="chat" state={sessionComposerState} />
  ), [sessionComposerState])

  return (
    <Suspense fallback={null}>
      <ChatView
        sessionId={sessionId}
        runtimeKind={runtimeKind}
        workspaceId={workspaceId}
        searchFiles={searchFiles}
        searchSkills={searchSkills}
        composerToolbar={composerToolbar}
        sendOverridesRef={sendOverridesRef}
        composerModel={sessionComposerState.effectiveModel}
        composerSelectionPending={composerSelectionPending}
      />
    </Suspense>
  )
}
