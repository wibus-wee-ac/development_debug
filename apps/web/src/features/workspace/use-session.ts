import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import {
  getSessionsOptions,
  getSessionsQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import type { GetSessionsData, GetSessionsResponse } from '~/api-gen/types.gen'
import type { RuntimeKind } from '~/lib/types'
import { useSessionLayoutStore } from '~/store/session-layout'

export interface WorkspaceSession {
  id: string
  workspaceId: string | null
  title: string | null
  providerTargetId: string | null
  agentId: string | null
  modelId: string | null
  linkedIssueId: string | null
  runtimeKind: RuntimeKind
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

function asWorkspaceSession(session: GetSessionsResponse[number]): WorkspaceSession {
  const archivedAt = (session as { archivedAt?: unknown }).archivedAt
  return {
    id: session.id,
    workspaceId: nullableString(session.workspaceId),
    title: nullableString(session.title),
    providerTargetId: nullableString(session.providerTargetId),
    agentId: nullableString(session.agentId),
    modelId: nullableString(session.modelId),
    linkedIssueId: nullableString(session.linkedIssueId),
    runtimeKind: session.runtimeKind,
    pinned: session.pinned,
    archivedAt: typeof archivedAt === 'number' ? archivedAt : null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

export function useAllSessions() {
  const { data: rawSessions = [], isPending: loading } = useQuery({
    ...getSessionsOptions(),
  })
  const sessions = rawSessions.map(asWorkspaceSession)

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

export function useSessions(workspaceId: string | null) {
  const queryOptions = sessionListOptions(workspaceId)
  const { data: rawSessions = [], isPending: loading } = useQuery({
    ...getSessionsOptions(queryOptions),
    enabled: Boolean(workspaceId),
  })
  const sessions = rawSessions.map(asWorkspaceSession)

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
