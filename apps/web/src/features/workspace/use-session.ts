import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import {
  getSessionsOptions,
  getSessionsQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import type { GetSessionsResponse } from '~/api-gen/types.gen'
import { useSessionLayoutStore } from '~/store/session-layout'

export type WorkspaceSession = GetSessionsResponse[number]

export const sessionsQueryKey = (workspaceId: string | null) =>
  workspaceId
    ? getSessionsQueryKey({ query: { workspaceId } })
    : ['getSessions', { query: { workspaceId: 'no-workspace' } }] as const

export function useSessions(workspaceId: string | null) {
  const { data: sessions = [], isPending: loading } = useQuery({
    ...getSessionsOptions({ query: { workspaceId: workspaceId! } }),
    enabled: !!workspaceId,
  })

  useEffect(() => {
    useSessionLayoutStore.getState().upsertSessions(sessions.map(session => ({
      sessionId: session.id,
      sessionTitle: session.title,
      workspaceId: session.workspaceId,
      runtimeKind: session.runtimeKind,
    })))
  }, [sessions])

  return { sessions, loading }
}
