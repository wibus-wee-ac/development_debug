// Output: Chat composer integration runtime for model capabilities, slash commands, token usage, and send actions.
// Input: Chat session binding, runtime capabilities, selected composer model, and chat session actions.
// Position: Owned by features/chat as the composer orchestration boundary consumed by ChatView.

import { useQuery } from '@tanstack/react-query'
import type { FileUIPart } from 'ai'
import { useCallback, useMemo } from 'react'

import { getSessionsByIdOptions } from '~/api-gen/@tanstack/react-query.gen'
import { getUsageSessionsBySessionId } from '~/api-gen/sdk.gen'
import { useProviderTargetModels } from '~/features/agent-runtime/use-agent-models'
import { useChatPreferencesQuery } from '~/features/settings/use-chat-preferences'
import { isElectron, platform } from '~/lib/electron'
import type { ModelDescriptor } from '~/lib/types'

import { getChatRuntimeCapabilities, getChatRuntimeUiSlotStates } from './chat-capabilities'
import type { ChatRuntimeUiSlotState } from './chat-capabilities'
import type { ChatComposerSlashCommand } from './chat-slash-commands'
import {
  CRADLE_APPSHOT_SLASH_COMMAND,
  createRuntimeUiSlotCommands,
  getFallbackRuntimeSlashCommands,
  mergeChatSlashCommands,
  withSlashCommandAvailability,
} from './chat-slash-commands'
import { modelSupportsAttachments } from './composer-attachment-state'
import type { SendMessageOptions } from './use-chat-session'

interface ChatComposerSendOverrides {
  providerTargetId?: string
  modelId?: string
  thinkingEffort?: 'low' | 'medium' | 'high' | 'auto' | null
}

export interface ChatComposerRuntime {
  disabled: boolean
  isStreaming: boolean
  goalCommandText: string | null
  send: (
    text: string,
    files: FileUIPart[],
    options?: { invertContinuationMode?: boolean },
  ) => void
  stop: () => void
  slashCommands: ChatComposerSlashCommand[]
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
  composerModel?: ModelDescriptor | null
  permissionMode?: SendMessageOptions['permissionMode']
  sendOverridesRef?: React.MutableRefObject<ChatComposerSendOverrides>
  sendMessage: (text: string, opts?: SendMessageOptions, files?: FileUIPart[]) => void | Promise<void>
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

export function useChatComposerRuntime({
  sessionId,
  status,
  isStreaming,
  messageCount,
  isReady,
  composerModel,
  permissionMode,
  sendOverridesRef,
  sendMessage,
  stop,
}: UseChatComposerRuntimeOptions): ChatComposerRuntime {
  const { data: chatPreferences } = useChatPreferencesQuery()
  const { data: runtimeCapabilities } = useQuery({
    queryKey: ['chat', 'runtime-capabilities', sessionId ?? 'no-session'] as const,
    queryFn: ({ signal }) => getChatRuntimeCapabilities(sessionId!, signal),
    enabled: !!sessionId,
    staleTime: 60_000,
    retry: false,
  })
  const { data: runtimeUiSlotStates } = useQuery({
    queryKey: ['chat', 'runtime-ui-slot-states', sessionId ?? 'no-session', runtimeCapabilities?.runtimeKind ?? 'unknown'] as const,
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

    return [appshotCommand]
  }, [supportsAttachments])
  const runtimeSlotCommands = useMemo(() => {
    return createRuntimeUiSlotCommands(runtimeCapabilities?.uiSlots ?? [], runtimeUiSlotStates?.states ?? [])
  }, [runtimeCapabilities?.uiSlots, runtimeUiSlotStates?.states])
  const goalCommandText = useMemo(() => {
    const goalCommand = runtimeSlotCommands.find(command => command.id === 'codex:goal')
    return goalCommand?.action.kind === 'insertText' ? goalCommand.action.text : null
  }, [runtimeSlotCommands])
  const slashCommands = useMemo(() => mergeChatSlashCommands({
    runtimeCommands: runtimeCapabilities?.slashCommands ?? [],
    runtimeUiSlotCommands: runtimeSlotCommands,
    fallbackRuntimeCommands: getFallbackRuntimeSlashCommands(runtimeCapabilities?.runtimeKind ?? sessionBinding?.runtimeKind),
    cradleCommands: cradleSlashCommands,
  }), [cradleSlashCommands, runtimeCapabilities?.runtimeKind, runtimeCapabilities?.slashCommands, runtimeSlotCommands, sessionBinding?.runtimeKind])

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

  const send = useCallback(
    (text: string, files: FileUIPart[], options?: { invertContinuationMode?: boolean }) => {
      if (!isReady || (!text.trim() && files.length === 0)) {
        return
      }

      const overrides = sendOverridesRef?.current
      const defaultContinuationMode = chatPreferences?.continuationBehavior ?? 'queue'
      const continuationMode = options?.invertContinuationMode
        ? invertContinuationMode(defaultContinuationMode)
        : defaultContinuationMode
      void sendMessage(text, { ...overrides, permissionMode, continuationMode }, files)
    },
    [chatPreferences?.continuationBehavior, isReady, permissionMode, sendMessage, sendOverridesRef],
  )

  return {
    disabled: !isReady,
    isStreaming,
    goalCommandText,
    send,
    stop,
    slashCommands,
    slotStates: runtimeUiSlotStates?.states ?? [],
    supportsAttachments,
    tokenUsage: {
      tokens: sessionTokens,
      contextWindow: sessionContextWindow,
    },
  }
}

function shouldPollRuntimeSlotStates(states: ChatRuntimeUiSlotState[]): boolean {
  return states.some(state => {
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
