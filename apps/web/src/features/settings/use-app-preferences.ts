// App preferences query and mutation helpers for Cradle-owned feature flags.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import { getPreferencesAppOptions, getPreferencesAppQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { putPreferencesApp } from '~/api-gen/sdk.gen'

export interface AppPreferences {
  featureFlags: {
    multiWorkspacePoc: boolean
  }
}

const AppPreferencesSchema = z.object({
  featureFlags: z.object({
    multiWorkspacePoc: z.boolean().default(false),
  }).default({
    multiWorkspacePoc: false,
  }),
})

export const APP_PREFS_QUERY_KEY = getPreferencesAppQueryKey()

export function useAppPreferencesQuery() {
  return useQuery({
    ...getPreferencesAppOptions(),
    select: data => AppPreferencesSchema.parse(data) satisfies AppPreferences,
  })
}

export function useUpdateAppPreferencesMutation() {
  const queryClient = useQueryClient()

  return useMutation<AppPreferences | null, Error, Partial<AppPreferences>>({
    mutationFn: async (updates) => {
      const current = queryClient.getQueryData<AppPreferences>(APP_PREFS_QUERY_KEY)
      if (!current) {
        return null
      }

      const next = {
        ...current,
        ...updates,
        featureFlags: {
          ...current.featureFlags,
          ...updates.featureFlags,
        },
      }
      await putPreferencesApp({ body: next, throwOnError: true })

      return next
    },
    onSuccess: (updated) => {
      if (updated) {
        queryClient.setQueryData(APP_PREFS_QUERY_KEY, updated)
      }
    },
  })
}

export function useAppPreferences() {
  const { data: prefs, isLoading, isSuccess } = useAppPreferencesQuery()
  const { mutateAsync: savePrefs, isPending: isSaving } = useUpdateAppPreferencesMutation()

  return { prefs: prefs ?? null, isLoading, isSuccess, savePrefs, isSaving }
}
