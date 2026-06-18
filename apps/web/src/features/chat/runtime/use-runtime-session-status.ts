import { useQuery } from '@tanstack/react-query'
import { runtimeSessionStatusQueryOptions } from '../commands/runtime-session-status-command'

export {
  runtimeSessionStatusQueryKey,
  runtimeSessionStatusQueryOptions,
} from '../commands/runtime-session-status-command'

const RUNTIME_STATUS_REFETCH_INTERVAL_MS = 1_000

export function useRuntimeSessionStatus(sessionId: string | null) {
  return useQuery({
    ...runtimeSessionStatusQueryOptions(sessionId),
    enabled: !!sessionId,
    staleTime: 1_000,
    refetchInterval: RUNTIME_STATUS_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
  })
}
