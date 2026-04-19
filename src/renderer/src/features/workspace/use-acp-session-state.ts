// Input: ipc proxy, TanStack Query, agentId + sessionId
// Output: useAcpSessionState hook — available models and configOptions for an active session
// Position: Data hook for model/thinking effort selection in the Composer

import type { AcpSessionState } from '@main/ipc-types'
import { ipc } from '@renderer/lib/ipc'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export type { AcpSessionState }

export function acpSessionStateQueryKey(agentId: string | null, sessionId: string | null) {
  return ['acp-session-state', agentId, sessionId] as const
}

export async function getAcpSessionState(
  agentId: string,
  sessionId: string,
): Promise<AcpSessionState | null> {
  return ipc!.acp.getSessionState(agentId, sessionId)
}

export async function setAcpSessionModel(
  agentId: string,
  sessionId: string,
  modelId: string,
): Promise<void> {
  await ipc!.acp.setSessionModel(agentId, sessionId, modelId)
}

export async function setAcpSessionConfigOption(
  agentId: string,
  sessionId: string,
  configId: string,
  value: string | boolean,
): Promise<void> {
  await ipc!.acp.setSessionConfigOption(agentId, sessionId, configId, value)
}

export function useAcpSessionState(agentId: string | null, sessionId: string | null) {
  const enabled = !!agentId && !!sessionId

  const { data: state } = useQuery({
    queryKey: acpSessionStateQueryKey(agentId, sessionId),
    queryFn: () => getAcpSessionState(agentId!, sessionId!),
    enabled,
    staleTime: Infinity, // session state changes only via mutations
  })

  const queryClient = useQueryClient()
  const key = acpSessionStateQueryKey(agentId, sessionId)

  const setModel = useMutation({
    mutationFn: (modelId: string) => setAcpSessionModel(agentId!, sessionId!, modelId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  const setConfigOption = useMutation({
    mutationFn: ({ configId, value }: { configId: string, value: string | boolean }) =>
      setAcpSessionConfigOption(agentId!, sessionId!, configId, value),
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
