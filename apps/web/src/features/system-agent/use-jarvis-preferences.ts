import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { getPreferencesJarvisOptions, getPreferencesJarvisQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { putPreferencesJarvis } from '~/api-gen/sdk.gen'
import type { PutPreferencesJarvisData } from '~/api-gen/types.gen'

export interface JarvisPreferences {
  profileId: string | null
  model?: string
  thinkingLevel: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
}

export const JARVIS_PREFS_QUERY_KEY = getPreferencesJarvisQueryKey()

export function useJarvisPreferencesQuery() {
  return useQuery({
    ...getPreferencesJarvisOptions(),
    select: data => data as JarvisPreferences,
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
        body: next as unknown as PutPreferencesJarvisData['body'],
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
  const { data: prefs, isLoading } = useJarvisPreferencesQuery()
  const { mutateAsync: savePrefs, isPending: isSaving } = useUpdateJarvisPreferencesMutation()

  return { prefs: prefs ?? null, isLoading, savePrefs, isSaving }
}
