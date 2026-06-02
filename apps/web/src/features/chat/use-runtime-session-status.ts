// Output: React Query hook for server-owned chat runtime session status.
// Input: Chat session id.
// Position: Chat feature state hook consumed by Right Aside runtime surfaces.

import { useQuery } from '@tanstack/react-query'

import { getRuntimeSessionStatus } from './runtime-session-status-command'

export function useRuntimeSessionStatus(sessionId: string | null) {
  return useQuery({
    queryKey: ['chat', 'runtime-session-status', sessionId ?? 'none'],
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
