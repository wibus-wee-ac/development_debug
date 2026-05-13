import { useQuery } from '@tanstack/react-query'

import { getSessionAwaitsSummaryOptions } from '~/api-gen/@tanstack/react-query.gen'

export function useSessionAwaitSummary(sessionId: string | null) {
  return useQuery({
    ...getSessionAwaitsSummaryOptions({ query: { sessionId: sessionId ?? '' } }),
    enabled: !!sessionId,
    refetchInterval: 10_000,
  })
}
