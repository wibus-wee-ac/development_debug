import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { getServerUrl } from '~/lib/electron'

const SERVER_BASE = getServerUrl()

export interface JarvisPreferences {
  profileId: string | null
  model?: string
  thinkingLevel: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
}

export const JARVIS_PREFS_QUERY_KEY = ['jarvis-preferences'] as const

export function useJarvisPreferences() {
  const queryClient = useQueryClient()

  const { data: prefs, isLoading } = useQuery({
    queryKey: JARVIS_PREFS_QUERY_KEY,
    queryFn: async (): Promise<JarvisPreferences> => {
      const res = await fetch(`${SERVER_BASE}/preferences/jarvis`)
      if (!res.ok) throw new Error('Failed to load Jarvis preferences')
      return res.json() as Promise<JarvisPreferences>
    },
  })

  const { mutateAsync: savePrefs, isPending: isSaving } = useMutation({
    mutationFn: async (updates: Partial<JarvisPreferences>) => {
      const current = prefs
      if (!current) return undefined
      const updated = { ...current, ...updates }
      await fetch(`${SERVER_BASE}/preferences/jarvis`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      })
      return updated
    },
    onSuccess: (updated) => {
      if (updated) {
        queryClient.setQueryData(JARVIS_PREFS_QUERY_KEY, updated)
      }
    },
  })

  return { prefs: prefs ?? null, isLoading, savePrefs, isSaving }
}
