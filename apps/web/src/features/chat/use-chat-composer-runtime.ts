import { useQuery } from '@tanstack/react-query'
import type { FileUIPart } from 'ai'
import { useCallback, useMemo } from 'react'

import { getSessionsByIdOptions } from '~/api-gen/@tanstack/react-query.gen'
import { getUsageSessionsBySessionId } from '~/api-gen/sdk.gen'
import { useProviderTargetModels } from '~/features/agent-runtime/use-agent-models'
import { useGitStatus } from '~/features/git/use-git'
import { useChatPreferencesQuery } from '~/features/settings/use-chat-preferences'
import { isElectron, platform } from '~/lib/electron'
import type { ModelDescriptor } from '~/lib/types'

import type { ChatRuntimeCompactUiSlotState, ChatRuntimeUiSlot, ChatRuntimeUiSlotState } from './chat-capabilities'
import { getChatRuntimeCapabilities, getChatRuntimeUiSlotStates, runtimeCapabilitiesQueryKey, runtimeUiSlotStatesQueryKey } from './chat-capabilities'
import type { ChatContextPart } from './chat-context-parts'
import type { ChatComposerSlashCommand } from './chat-slash-commands'
import {
  CODEX_USAGE_SLASH_ACTION_ID,
  CRADLE_APPSHOT_SLASH_COMMAND,
  CRADLE_SIDE_CHAT_SLASH_COMMAND,
  projectRuntimeComposerSlashCommands,
  withSlashCommandAvailability,
} from './chat-slash-commands'
import { modelSupportsAttachments } from './composer-attachment-state'
import type { SendMessageOptions, SendMessageResult } from './use-chat-session'

interface ChatComposerSendOverrides {
  providerTargetId?: string
  modelId?: string
  thinkingEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'auto' | null
}

export interface ChatComposerRuntime {
  disabled: boolean
  isStreaming: boolean
  send: (
    text: string,
    files: FileUIPart[],
    contextParts: ChatContextPart[],
    options?: { invertContinuationMode?: boolean },
  ) => SendMessageResult | Promise<SendMessageResult>
  stop: () => void
  slashCommands: ChatComposerSlashCommand[]
  uiSlots: ChatRuntimeUiSlot[]
  slotStates: ChatRuntimeUiSlotState[]
  supportsAttachments: boolean
  tokenUsage: {
    tokens: number
    contextWindow: number | null
  }
}

interface UseChatComposerRuntimeOptions {
  sessionId: string | null
  status: string
  isStreaming: boolean
  messageCount: number
  isReady: boolean
  workspaceId?: string | null
  composerModel?: ModelDescriptor | null
  permissionMode?: SendMessageOptions['permissionMode']
  sendOverridesRef?: React.MutableRefObject<ChatComposerSendOverrides>
  sendMessage: (text: string, opts?: SendMessageOptions, files?: FileUIPart[], contextParts?: ChatContextPart[]) => SendMessageResult | Promise<SendMessageResult>
  stop: () => void
}

interface SessionBinding {
  providerTargetId: string | null
  modelId: string | null
  runtimeKind?: string | null
}

function invertContinuationMode(mode: NonNullable<SendMessageOptions['continuationMode']>): NonNullable<SendMessageOptions['continuationMode']> {
  return mode === 'queue' ? 'steer' : 'queue'
}

function readCodexReviewAvailability({
  workspaceId,
  gitStatusLoading,
  gitStatusUnavailable,
}: {
  workspaceId?: string | null
  gitStatusLoading: boolean
  gitStatusUnavailable: boolean
}): ChatComposerSlashCommand['availability'] {
  if (!workspaceId) {
    return {
      enabled: false,
      reason: 'Requires a workspace-backed Git repository.',
    }
  }
  if (gitStatusLoading) {
    return {
      enabled: false,
      reason: 'Checking Git repository.',
    }
  }
  if (gitStatusUnavailable) {
    return {
      enabled: false,
      reason: 'Git repository unavailable.',
    }
  }
  return undefined
}

export function useChatComposerRuntime({
  sessionId,
  status,
  isStreaming,
  messageCount,
  isReady,
  workspaceId,
  composerModel,
  permissionMode,
  sendOverridesRef,
  sendMessage,
  stop,
}: UseChatComposerRuntimeOptions): ChatComposerRuntime {
  const { data: chatPreferences } = useChatPreferencesQuery()
  const { data: runtimeCapabilities } = useQuery({
    queryKey: runtimeCapabilitiesQueryKey(sessionId),
    queryFn: ({ signal }) => getChatRuntimeCapabilities(sessionId!, signal),
    enabled: !!sessionId,
    staleTime: 60_000,
    retry: false,
  })
  const { data: runtimeUiSlotStates } = useQuery({
    queryKey: runtimeUiSlotStatesQueryKey(sessionId, runtimeCapabilities?.runtimeKind),
    queryFn: ({ signal }) => getChatRuntimeUiSlotStates(sessionId!, signal),
    enabled: !!sessionId,
    staleTime: 2_000,
    refetchInterval: query => isStreaming || shouldPollRuntimeSlotStates(query.state.data?.states ?? []) ? 5_000 : false,
    retry: false,
  })
  const { data: sessionBinding } = useQuery({
    ...getSessionsByIdOptions({ path: { id: sessionId ?? '' } }),
    enabled: !!sessionId,
    staleTime: 60_000,
    select: data => (data ? data as SessionBinding : null),
  })
  const boundProviderTarget = useMemo(() => {
    return sessionBinding?.providerTargetId ? { id: sessionBinding.providerTargetId } : null
  }, [sessionBinding?.providerTargetId])
  const { models: sessionModels } = useProviderTargetModels(boundProviderTarget)
  const hasCodexReviewSlot = useMemo(() => {
    return Boolean(runtimeCapabilities?.uiSlots.some(slot => slot.id === 'codex:review'))
  }, [runtimeCapabilities?.uiSlots])
  const gitStatusQuery = useGitStatus(hasCodexReviewSlot ? workspaceId : null)
  const currentSessionModel = useMemo(() => {
    if (composerModel) {
      return composerModel
    }
    if (!sessionBinding?.modelId) {
      return null
    }
    return sessionModels.find(candidate => candidate.id === sessionBinding.modelId) ?? null
  }, [composerModel, sessionBinding?.modelId, sessionModels])
  const sessionContextWindow = useMemo(() => {
    const contextWindow = currentSessionModel?.capabilities.contextWindow
    return contextWindow != null && contextWindow > 0 ? contextWindow : null
  }, [currentSessionModel])
  const supportsAttachments = useMemo(() => {
    return modelSupportsAttachments(currentSessionModel)
  }, [currentSessionModel])
  const cradleSlashCommands = useMemo(() => {
    const appshotCommand = (() => {
      if (!isElectron || platform !== 'darwin') {
        return withSlashCommandAvailability(CRADLE_APPSHOT_SLASH_COMMAND, {
          enabled: false,
          reason: 'Requires the macOS desktop app.',
        })
      }
      if (!supportsAttachments) {
        return withSlashCommandAvailability(CRADLE_APPSHOT_SLASH_COMMAND, {
          enabled: false,
          reason: 'Requires an image-capable model.',
        })
      }
      return withSlashCommandAvailability(CRADLE_APPSHOT_SLASH_COMMAND, undefined)
    })()

    return [CRADLE_SIDE_CHAT_SLASH_COMMAND, appshotCommand]
  }, [supportsAttachments])
  const mapRuntimeUiSlotCommand = useCallback((command: ChatComposerSlashCommand) => {
    if (command.id === 'codex:review') {
      return withSlashCommandAvailability(command, readCodexReviewAvailability({
        workspaceId,
        gitStatusLoading: gitStatusQuery.isLoading,
        gitStatusUnavailable: gitStatusQuery.isError,
      }))
    }
    if (command.action.kind === 'uiAction' && command.action.actionId === CODEX_USAGE_SLASH_ACTION_ID) {
      const usageState = runtimeUiSlotStates?.states.find(state => state.kind === 'usage')
      return withSlashCommandAvailability(command, usageState && isRuntimeUsageSlotStateAvailable(usageState)
        ? undefined
        : { enabled: false, reason: 'Usage rate limits are unavailable for this session.' })
    }
    return command
  }, [gitStatusQuery.isError, gitStatusQuery.isLoading, runtimeUiSlotStates?.states, workspaceId])
  const slashCommands = useMemo(() => projectRuntimeComposerSlashCommands({
    capabilities: runtimeCapabilities,
    slotStates: runtimeUiSlotStates?.states ?? [],
    mode: 'session',
    cradleCommands: cradleSlashCommands,
    mapRuntimeUiSlotCommand,
  }), [cradleSlashCommands, mapRuntimeUiSlotCommand, runtimeCapabilities, runtimeUiSlotStates?.states])

  const { data: sessionTokens = 0 } = useQuery({
    queryKey: ['chat', 'session-usage', sessionId ?? 'no-session', messageCount] as const,
    queryFn: async () => {
      const res = await getUsageSessionsBySessionId({ path: { sessionId: sessionId! } })
      return res.data?.totalTokens ?? 0
    },
    enabled: !!sessionId && status !== 'streaming',
    staleTime: 10_000,
    retry: false,
  })
  const compactSlotState = useMemo(() => {
    return (runtimeUiSlotStates?.states ?? []).find((state): state is ChatRuntimeCompactUiSlotState => state.kind === 'compact') ?? null
  }, [runtimeUiSlotStates?.states])

  const send = useCallback(
    (text: string, files: FileUIPart[], contextParts: ChatContextPart[], options?: { invertContinuationMode?: boolean }) => {
      if (!isReady || (!text.trim() && files.length === 0 && contextParts.length === 0)) {
        return
      }

      const overrides = sendOverridesRef?.current
      const defaultContinuationMode = chatPreferences?.continuationBehavior ?? 'queue'
      const continuationMode = options?.invertContinuationMode
        ? invertContinuationMode(defaultContinuationMode)
        : defaultContinuationMode
      return sendMessage(text, { ...overrides, permissionMode, continuationMode }, files, contextParts)
    },
    [chatPreferences?.continuationBehavior, isReady, permissionMode, sendMessage, sendOverridesRef],
  )

  return {
    disabled: !isReady,
    isStreaming,
    send,
    stop,
    slashCommands,
    uiSlots: runtimeCapabilities?.uiSlots ?? [],
    slotStates: runtimeUiSlotStates?.states ?? [],
    supportsAttachments,
    tokenUsage: {
      tokens: compactSlotState?.total.totalTokens ?? sessionTokens,
      contextWindow: compactSlotState?.modelContextWindow ?? sessionContextWindow,
    },
  }
}

function isRuntimeUsageSlotStateAvailable(state: ChatRuntimeUiSlotState): boolean {
  return state.kind === 'usage'
    && (
      state.usedPercent !== null
      || state.secondaryUsedPercent !== null
      || state.limitName !== null
      || state.primaryResetsAt !== null
      || state.secondaryResetsAt !== null
      || state.creditsBalance !== null
      || state.rateLimitReachedType !== null
    )
}

function shouldPollRuntimeSlotStates(states: ChatRuntimeUiSlotState[]): boolean {
  return states.some((state) => {
    if (state.kind === 'goal') {
      return state.status === 'active'
    }
    if (state.kind === 'compact') {
      return state.isCompactRelevant
    }
    if (state.kind === 'status') {
      return state.status === 'active'
    }
    if (state.kind === 'toolActivity') {
      return state.activeCount > 0
    }
    if (state.kind === 'mcp') {
      return Boolean(state.recentProgress)
    }
    return false
  })
}
