import { useQuery } from '@tanstack/react-query'
import { getRuntimeSessionStatus } from '../commands/runtime-session-status-command'

const RUNTIME_STATUS_REFETCH_INTERVAL_MS = 1_000

export function runtimeSessionStatusQueryKey(sessionId: string | null): readonly unknown[] {
  return ['chat', 'runtime-session-status', sessionId ?? 'none']
}

export function useRuntimeSessionStatus(sessionId: string | null) {
  return useQuery({
    queryKey: runtimeSessionStatusQueryKey(sessionId),
    queryFn: () => getRuntimeSessionStatus(sessionId!),
    enabled: !!sessionId,
    staleTime: 1_000,
    refetchInterval: RUNTIME_STATUS_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
  })
}
