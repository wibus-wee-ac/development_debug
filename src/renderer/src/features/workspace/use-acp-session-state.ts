// Input: ipc proxy, TanStack Query, agentId + sessionId
// Output: useAcpSessionState hook — available models and configOptions for an active session
// Position: Data hook for model/thinking effort selection in the Composer

import type { AcpSessionState } from '@main/ipc-types'
import { ipc } from '@renderer/lib/ipc'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export type { AcpSessionState }

export function useAcpSessionState(agentId: string | null, sessionId: string | null) {
  const enabled = !!agentId && !!sessionId

  const { data: state } = useQuery({
    queryKey: ['acp-session-state', agentId, sessionId],
    queryFn: () => ipc!.acp.getSessionState(agentId!, sessionId!),
    enabled,
    staleTime: Infinity, // session state changes only via mutations
  })

  const queryClient = useQueryClient()
  const key = ['acp-session-state', agentId, sessionId]

  const setModel = useMutation({
    mutationFn: (modelId: string) => ipc!.acp.setSessionModel(agentId!, sessionId!, modelId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  const setConfigOption = useMutation({
    mutationFn: ({ configId, value }: { configId: string; value: string | boolean }) =>
      ipc!.acp.setSessionConfigOption(agentId!, sessionId!, configId, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  return {
    state: state ?? null,
    models: state?.models ?? null,
    configOptions: state?.configOptions ?? [],
    setModel: setModel.mutate,
    setConfigOption: setConfigOption.mutate,
  }
}
