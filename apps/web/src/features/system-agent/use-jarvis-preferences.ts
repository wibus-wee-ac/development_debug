import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { getPreferencesJarvisOptions, getPreferencesJarvisQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { putPreferencesJarvis } from '~/api-gen/sdk.gen'

export interface JarvisPreferences {
  profileId: string | null
  model?: string
  thinkingLevel: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
}

const JarvisPreferencesSchema = z.object({
  profileId: z.string().nullable(),
  model: z.string().optional(),
  thinkingLevel: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']),
})

export const JARVIS_PREFS_QUERY_KEY = getPreferencesJarvisQueryKey()

export function useJarvisPreferencesQuery() {
  return useQuery({
    ...getPreferencesJarvisOptions(),
    select: data => JarvisPreferencesSchema.parse(data) satisfies JarvisPreferences,
  })
}

export function useUpdateJarvisPreferencesMutation() {
  const queryClient = useQueryClient()

  return useMutation<JarvisPreferences | null, Error, Partial<JarvisPreferences>>({
    mutationFn: async (updates) => {
      const current = queryClient.getQueryData<JarvisPreferences>(JARVIS_PREFS_QUERY_KEY)
      if (!current) {
        return null
      }

      const next = { ...current, ...updates }
      await putPreferencesJarvis({
        body: next,
      })

      return next
    },
    onSuccess: (updated) => {
      if (updated) {
        queryClient.setQueryData(JARVIS_PREFS_QUERY_KEY, updated)
      }
    },
  })
}

export function useJarvisPreferences() {
  const { data: prefs, isLoading, isSuccess } = useJarvisPreferencesQuery()
  const { mutateAsync: savePrefs, isPending: isSaving } = useUpdateJarvisPreferencesMutation()

  return { prefs: prefs ?? null, isLoading, isSuccess, savePrefs, isSaving }
}
