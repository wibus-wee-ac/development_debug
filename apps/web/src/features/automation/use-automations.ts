import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { listAutomationArtifacts, listAutomationDefinitions, listAutomationRuns, runAutomationNow } from './api-client'

export const automationQueryKeys = {
  definitions: ['automations', 'definitions'] as const,
  runs: (automationId: string) => ['automations', automationId, 'runs'] as const,
  artifacts: (automationId: string) => ['automations', automationId, 'artifacts'] as const,
}

export function useAutomationDefinitions() {
  return useQuery({
    queryKey: automationQueryKeys.definitions,
    queryFn: listAutomationDefinitions,
    staleTime: 15_000,
    retry: 1,
  })
}

export function useAutomationRuns(automationId: string | null) {
  return useQuery({
    queryKey: automationId ? automationQueryKeys.runs(automationId) : ['automations', 'missing', 'runs'],
    queryFn: () => listAutomationRuns(automationId ?? ''),
    enabled: Boolean(automationId),
    staleTime: 10_000,
    retry: 1,
  })
}

export function useAutomationArtifacts(automationId: string | null) {
  return useQuery({
    queryKey: automationId ? automationQueryKeys.artifacts(automationId) : ['automations', 'missing', 'artifacts'],
    queryFn: () => listAutomationArtifacts(automationId ?? ''),
    enabled: Boolean(automationId),
    staleTime: 10_000,
    retry: 1,
  })
}

export function useRunAutomationNow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: runAutomationNow,
    onSuccess: async (_run, automationId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: automationQueryKeys.definitions }),
        queryClient.invalidateQueries({ queryKey: automationQueryKeys.runs(automationId) }),
        queryClient.invalidateQueries({ queryKey: automationQueryKeys.artifacts(automationId) }),
      ])
    },
  })
}
