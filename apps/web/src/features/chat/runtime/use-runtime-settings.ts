// React Query integration for Chat Runtime session settings.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { ChatRuntimeSettings, ChatRuntimeSettingsPatch } from '../commands/chat-response-command'
import type { ChatRuntimeSettingsResponse } from '../commands/runtime-settings-command'
import {
  DEFAULT_CHAT_RUNTIME_SETTINGS,
  getSessionRuntimeSettings,
  runtimeSettingsQueryKey,
  updateSessionRuntimeSettings,
} from '../commands/runtime-settings-command'

export interface ChatRuntimeSettingsState {
  settings: ChatRuntimeSettings
  applied: boolean
  loaded: boolean
  loading: boolean
  saving: boolean
  update: (patch: ChatRuntimeSettingsPatch) => Promise<ChatRuntimeSettingsResponse | null>
}

export function useRuntimeSettings(sessionId: string | null): ChatRuntimeSettingsState {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: runtimeSettingsQueryKey(sessionId),
    queryFn: () => getSessionRuntimeSettings(sessionId!),
    enabled: !!sessionId,
    staleTime: 10_000,
    retry: false,
  })
  const mutation = useMutation({
    mutationFn: (patch: ChatRuntimeSettingsPatch) => updateSessionRuntimeSettings({
      sessionId: sessionId!,
      patch,
    }),
    onMutate: async (patch) => {
      const currentSessionId = sessionId!
      const queryKey = runtimeSettingsQueryKey(currentSessionId)
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<ChatRuntimeSettingsResponse>(queryKey)
      queryClient.setQueryData<ChatRuntimeSettingsResponse>(queryKey, {
        sessionId: currentSessionId,
        runtimeSettings: {
          ...(previous?.runtimeSettings ?? DEFAULT_CHAT_RUNTIME_SETTINGS),
          ...patch,
        },
        applied: false,
      })
      return { previous, queryKey }
    },
    onError: (_error, _patch, context) => {
      if (context) {
        queryClient.setQueryData(context.queryKey, context.previous)
      }
    },
    onSuccess: (response) => {
      queryClient.setQueryData(runtimeSettingsQueryKey(response.sessionId), response)
      void queryClient.invalidateQueries({ queryKey: ['chat', 'runtime-session-status', response.sessionId] })
    },
  })

  return {
    settings: query.data?.runtimeSettings ?? DEFAULT_CHAT_RUNTIME_SETTINGS,
    applied: query.data?.applied ?? false,
    loaded: Boolean(query.data),
    loading: query.isLoading,
    saving: mutation.isPending,
    update: async (patch) => {
      if (!sessionId) {
        return null
      }
      return await mutation.mutateAsync(patch)
    },
  }
}
