import type { QueryClient } from '@tanstack/react-query'
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
  latestUserMessageAt: number | null
  listActivityAt: number
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

export function isSessionsQueryKey(queryKey: readonly unknown[]): boolean {
  const head = queryKey[0]
  return head !== null
    && typeof head === 'object'
    && (head as { _id?: unknown })._id === 'getSessions'
}

type SessionListResponseRow = GetSessionsResponse[number] & {
  latestUserMessageAt?: unknown
}

type SessionListOptimisticPatch = Partial<SessionListResponseRow> & {
  id: string
}

interface SessionListOptimisticOptions {
  promote?: boolean
  updatedAt?: number
  latestUserMessageAt?: number
}

function queryKeyMatchesWorkspace(queryKey: readonly unknown[], workspaceId: string | null | undefined): boolean {
  if (workspaceId === undefined) {
    return true
  }
  const query = queryKey[0] && typeof queryKey[0] === 'object' && 'query' in queryKey[0]
    ? (queryKey[0].query as { workspaceId?: unknown } | undefined)
    : undefined
  return query?.workspaceId === undefined || query.workspaceId === workspaceId
}

function queryKeyMatchesArchiveState(queryKey: readonly unknown[], archivedAt: number | null | undefined): boolean {
  if (archivedAt === undefined) {
    return true
  }
  const query = queryKey[0] && typeof queryKey[0] === 'object' && 'query' in queryKey[0]
    ? (queryKey[0].query as { archived?: unknown } | undefined)
    : undefined
  return archivedAt === null
    ? query?.archived !== true
    : query?.archived === true
}

function readOptimisticWorkspaceId(value: unknown): string | null | undefined {
  return typeof value === 'string' || value === null ? value : undefined
}

function readOptimisticArchivedAt(value: unknown): number | null | undefined {
  return typeof value === 'number' || value === null ? value : undefined
}

export function updateSessionInSessionLists(
  queryClient: QueryClient,
  patch: SessionListOptimisticPatch,
  options: SessionListOptimisticOptions = {},
) {
  const now = Math.floor(Date.now() / 1000)
  const optimisticUpdatedAt = options.updatedAt ?? (options.promote ? now : undefined)
  const optimisticLatestUserMessageAt = options.latestUserMessageAt ?? (options.promote ? now : undefined)
  const workspaceId = readOptimisticWorkspaceId(patch.workspaceId)
  const archivedAt = readOptimisticArchivedAt(patch.archivedAt)
  queryClient.setQueriesData<GetSessionsResponse>(
    {
      predicate: query =>
        isSessionsQueryKey(query.queryKey)
        && queryKeyMatchesWorkspace(query.queryKey, workspaceId)
        && queryKeyMatchesArchiveState(query.queryKey, archivedAt ?? null),
    },
    (sessions) => {
      if (!sessions) {
        return sessions
      }
      const next = sessions.slice()
      const index = next.findIndex(session => session.id === patch.id)
      const existing = index >= 0 ? next.splice(index, 1)[0] : null
      if (!existing && patch.workspaceId === undefined) {
        return sessions
      }
      const updatedAt = patch.updatedAt ?? optimisticUpdatedAt ?? existing?.updatedAt ?? now
      const latestUserMessageAt
        = patch.latestUserMessageAt ?? optimisticLatestUserMessageAt ?? (existing as SessionListResponseRow | null)?.latestUserMessageAt ?? null
      const row = {
        workspaceId: null,
        title: null,
        providerTargetId: null,
        agentId: null,
        modelId: null,
        linkedIssueId: null,
        runtimeKind: 'standard',
        pinned: 0,
        archivedAt: null,
        createdAt: updatedAt,
        ...existing,
        ...patch,
        id: patch.id,
        updatedAt,
        latestUserMessageAt,
        status: patch.status ?? existing?.status ?? 'streaming',
      } as GetSessionsResponse[number]

      if (existing && !options.promote) {
        next.splice(index, 0, row)
        return next
      }

      next.unshift(row)
      return next
    },
  )
}

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
  const latestUserMessageAt = (session as { latestUserMessageAt?: unknown }).latestUserMessageAt
  const status = (session as { status?: unknown }).status
  const normalizedLatestUserMessageAt = typeof latestUserMessageAt === 'number' ? latestUserMessageAt : null
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
    latestUserMessageAt: normalizedLatestUserMessageAt,
    listActivityAt: normalizedLatestUserMessageAt ?? session.createdAt,
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
