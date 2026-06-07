import { useQuery } from '@tanstack/react-query'
import { getRuntimeSessionStatus } from '../commands/runtime-session-status-command'


export function runtimeSessionStatusQueryKey(sessionId: string | null): readonly unknown[] {
  return ['chat', 'runtime-session-status', sessionId ?? 'none']
}

export function useRuntimeSessionStatus(sessionId: string | null) {
  return useQuery({
    queryKey: runtimeSessionStatusQueryKey(sessionId),
    queryFn: () => getRuntimeSessionStatus(sessionId!),
    enabled: !!sessionId,
    staleTime: 1_000,
    refetchInterval: query => query.state.data?.status === 'streaming'
      || query.state.data?.status === 'pending'
      || query.state.data?.status === 'cancelling'
      || query.state.data?.hasActiveGoal
      ? 1_000
      : false,
  })
}
