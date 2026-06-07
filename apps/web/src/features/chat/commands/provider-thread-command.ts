// Chat Runtime provider-thread HTTP boundary for provider-native subagent/thread detail panels.
import type { UIMessage } from 'ai'

import { getServerUrl } from '~/lib/electron'

const SERVER_BASE = getServerUrl()

export interface ProviderThread {
  id: string
  providerSessionTreeId: string | null
  forkedFromId: string | null
  preview: string | null
  ephemeral: boolean
  modelProvider: string | null
  createdAt: number | null
  updatedAt: number | null
  status: string
  sourceKind: string
  source: unknown
  threadSource: unknown
  agentNickname: string | null
  agentRole: string | null
  name: string | null
  cwd: string | null
}

export interface ProviderThreadReadResponse {
  runtimeKind: string
  providerSessionId: string | null
  thread: ProviderThread
}

export interface ProviderThreadTurnsResponse {
  runtimeKind: string
  providerSessionId: string | null
  threadId: string
  turns: Array<{
    id: string
    status: string
    startedAt: number | null
    completedAt: number | null
    durationMs: number | null
    itemsView: string
    items: unknown[]
  }>
  messages: UIMessage[]
  nextCursor: string | null
  backwardsCursor: string | null
}

export function providerThreadQueryKey(sessionId: string, threadId: string): readonly unknown[] {
  return ['chat', 'provider-thread', sessionId, threadId]
}

export function providerThreadTurnsQueryKey(sessionId: string, threadId: string): readonly unknown[] {
  return ['chat', 'provider-thread-turns', sessionId, threadId]
}

export async function getProviderThread(
  sessionId: string,
  threadId: string,
  signal?: AbortSignal,
): Promise<ProviderThreadReadResponse> {
  const res = await fetch(`${SERVER_BASE}/chat/sessions/${encodeURIComponent(sessionId)}/provider-threads/${encodeURIComponent(threadId)}`, { signal })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to load provider thread: ${res.status} ${body}`)
  }
  return await res.json() as ProviderThreadReadResponse
}

export async function getProviderThreadTurns(
  sessionId: string,
  threadId: string,
  signal?: AbortSignal,
): Promise<ProviderThreadTurnsResponse> {
  const res = await fetch(`${SERVER_BASE}/chat/sessions/${encodeURIComponent(sessionId)}/provider-threads/${encodeURIComponent(threadId)}/turns?sortDirection=asc`, { signal })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to load provider thread turns: ${res.status} ${body}`)
  }
  return await res.json() as ProviderThreadTurnsResponse
}

export function subscribeProviderThreadStream(args: {
  sessionId: string
  threadId: string
  signal?: AbortSignal
}): Promise<Response> {
  return fetch(`${SERVER_BASE}/chat/sessions/${encodeURIComponent(args.sessionId)}/provider-threads/${encodeURIComponent(args.threadId)}/stream`, {
    method: 'GET',
    signal: args.signal,
  })
}
