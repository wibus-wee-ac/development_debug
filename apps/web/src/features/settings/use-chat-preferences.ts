// Chat preferences query and mutation helpers for settings and continuation UI.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { getPreferencesChatOptions, getPreferencesChatQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { putPreferencesChat } from '~/api-gen/sdk.gen'

export type ContinuationBehavior = 'queue' | 'steer'
export type ApprovalMode = 'ask' | 'allowAll'

export interface ChatPreferences {
  modelId: string | null
  configSelections: Record<string, unknown>
  continuationBehavior: ContinuationBehavior
  approvalMode: ApprovalMode
}

const ChatPreferencesSchema = z.object({
  modelId: z.unknown().nullable().transform(value => typeof value === 'string' ? value : null),
  configSelections: z.record(z.string(), z.unknown()).default({}),
  continuationBehavior: z.enum(['queue', 'steer']).default('queue'),
  approvalMode: z.enum(['ask', 'allowAll']).default('ask'),
})

export const CHAT_PREFS_QUERY_KEY = getPreferencesChatQueryKey()

export function useChatPreferencesQuery() {
  return useQuery({
    ...getPreferencesChatOptions(),
    select: data => ChatPreferencesSchema.parse(data) satisfies ChatPreferences,
  })
}

export function useUpdateChatPreferencesMutation() {
  const queryClient = useQueryClient()

  return useMutation<ChatPreferences | null, Error, Partial<ChatPreferences>>({
    mutationFn: async (updates) => {
      const current = queryClient.getQueryData<ChatPreferences>(CHAT_PREFS_QUERY_KEY)
      if (!current) {
        return null
      }

      const next = { ...current, ...updates }
      await putPreferencesChat({ body: next, throwOnError: true })

      return next
    },
    onSuccess: (updated) => {
      if (updated) {
        queryClient.setQueryData(CHAT_PREFS_QUERY_KEY, updated)
      }
    },
  })
}

export function useChatPreferences() {
  const { data: prefs, isLoading, isSuccess } = useChatPreferencesQuery()
  const { mutateAsync: savePrefs, isPending: isSaving } = useUpdateChatPreferencesMutation()

  return { prefs: prefs ?? null, isLoading, isSuccess, savePrefs, isSaving }
}
