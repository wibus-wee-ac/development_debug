import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'

import {
  getSessionsOptions,
  getSessionsQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import type { GetSessionsData, GetSessionsResponse } from '~/api-gen/types.gen'
import { queryRefreshPolicy } from '~/lib/query-refresh-policy'
import type { RuntimeKind } from '~/lib/types'
import { useSessionLayoutStore } from '~/store/session-layout'

const SESSION_LIST_REFRESH_INTERVAL_MS = 10_000

export interface WorkspaceSession {
  id: string
  workspaceId: string | null
  title: string | null
  providerTargetId: string | null
  agentId: string | null
  modelId: string | null
  linkedIssueId: string | null
  runtimeKind: RuntimeKind
  status: 'idle' | 'streaming' | 'error'
  pinned: number
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}

function sessionListOptions(workspaceId?: string | null, archived?: boolean): GetSessionsData | undefined {
  const query: NonNullable<GetSessionsData['query']> = {}

  if (workspaceId) {
    query.workspaceId = workspaceId
  }
  if (archived !== undefined) {
    query.archived = archived
  }

  return Object.keys(query).length > 0
    ? { url: '/sessions/', query }
    : undefined
}

export const sessionsQueryKey = (workspaceId?: string | null, archived?: boolean) =>
  getSessionsQueryKey(sessionListOptions(workspaceId, archived))

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readSessionStatus(value: unknown): WorkspaceSession['status'] {
  if (value === 'streaming' || value === 'error') {
    return value
  }
  return 'idle'
}

function asWorkspaceSession(session: GetSessionsResponse[number]): WorkspaceSession {
  const archivedAt = (session as { archivedAt?: unknown }).archivedAt
  const status = (session as { status?: unknown }).status
  return {
    id: session.id,
    workspaceId: nullableString(session.workspaceId),
    title: nullableString(session.title),
    providerTargetId: nullableString(session.providerTargetId),
    agentId: nullableString(session.agentId),
    modelId: nullableString(session.modelId),
    linkedIssueId: nullableString(session.linkedIssueId),
    runtimeKind: session.runtimeKind,
    status: readSessionStatus(status),
    pinned: session.pinned,
    archivedAt: typeof archivedAt === 'number' ? archivedAt : null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

function asSessionLayoutRecords(sessions: WorkspaceSession[]) {
  return sessions.map(session => ({
    sessionId: session.id,
    sessionTitle: session.title,
    workspaceId: session.workspaceId,
    runtimeKind: session.runtimeKind,
  }))
}

export function useAllSessions(archived?: boolean) {
  const queryOptions = sessionListOptions(null, archived)
  const { data: rawSessions = [], isPending: loading } = useQuery({
    ...getSessionsOptions(queryOptions),
    ...queryRefreshPolicy('active', { refetchInterval: SESSION_LIST_REFRESH_INTERVAL_MS }),
  })
  const sessions = useMemo(() => rawSessions.map(asWorkspaceSession), [rawSessions])

  useEffect(() => {
    useSessionLayoutStore.getState().upsertSessions(asSessionLayoutRecords(sessions))
  }, [sessions])

  return { sessions, loading }
}

export function useWorkspaceSessions(workspaceId: string | null, archived?: boolean) {
  const queryOptions = sessionListOptions(workspaceId, archived)
  const { data: rawSessions = [], isPending: loading } = useQuery({
    ...getSessionsOptions(queryOptions),
    ...queryRefreshPolicy('active', { refetchInterval: SESSION_LIST_REFRESH_INTERVAL_MS }),
    enabled: Boolean(workspaceId),
  })
  const sessions = useMemo(() => rawSessions.map(asWorkspaceSession), [rawSessions])

  useEffect(() => {
    useSessionLayoutStore.getState().upsertSessions(asSessionLayoutRecords(sessions))
  }, [sessions])

  return { sessions, loading }
}
