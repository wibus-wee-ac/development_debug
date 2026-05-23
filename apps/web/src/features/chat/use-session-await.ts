import { useQuery } from '@tanstack/react-query'

import { getSessionAwaitsSummaryOptions } from '~/api-gen/@tanstack/react-query.gen'
import { queryRefreshPolicies } from '~/lib/query-refresh-policy'

export function useSessionAwaitSummary(sessionId: string | null) {
  return useQuery({
    ...getSessionAwaitsSummaryOptions({ query: { sessionId: sessionId ?? '' } }),
    ...queryRefreshPolicies.interactive,
    enabled: !!sessionId,
  })
}
