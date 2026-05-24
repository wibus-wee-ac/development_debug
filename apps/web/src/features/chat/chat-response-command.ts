import type { FileUIPart } from 'ai'
import { getServerUrl } from '~/lib/electron'

const SERVER_BASE = getServerUrl()

export interface ChatResponseRequestBody {
  text: string
  files?: FileUIPart[]
  agentProfileId?: string
  modelId?: string
  thinkingEffort?: 'low' | 'medium' | 'high'
}

export type ChatContinuationMode = 'queue' | 'steer'
export type ChatQueueItemStatus = 'pending' | 'running' | 'cancelled' | 'completed' | 'failed'

export interface ChatQueueItem {
  id: string
  sessionId: string
  mode: ChatContinuationMode
  status: ChatQueueItemStatus
  text: string
  files: FileUIPart[]
  agentProfileId: string | null
  modelId: string | null
  thinkingEffort: 'low' | 'medium' | 'high' | null
  position: number
  sourceRunId: string | null
  startedRunId: string | null
  errorText: string | null
  createdAt: number
  updatedAt: number
}

export interface ChatQueueListResponse {
  items: ChatQueueItem[]
}

export interface ChatQueueEnqueueBody extends ChatResponseRequestBody {
  mode: ChatContinuationMode
}

export function buildChatResponseRequestBody(
  body: ChatResponseRequestBody,
): ChatResponseRequestBody {
  return {
    text: body.text,
    files: body.files,
    agentProfileId: body.agentProfileId ?? undefined,
    modelId: body.modelId ?? undefined,
    thinkingEffort: body.thinkingEffort ?? undefined,
  }
}

export async function startChatResponse(args: {
  sessionId: string
  body: ChatResponseRequestBody
  signal?: AbortSignal
}): Promise<Response> {
  return fetch(`${SERVER_BASE}/chat/sessions/${args.sessionId}/response`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildChatResponseRequestBody(args.body)),
    signal: args.signal,
  })
}

export async function listChatSessionQueue(sessionId: string): Promise<ChatQueueListResponse> {
  const res = await fetch(`${SERVER_BASE}/chat/sessions/${sessionId}/queue`)

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to list chat queue: ${res.status} ${body}`)
  }

  return await res.json() as ChatQueueListResponse
}

export async function enqueueChatSessionQueueItem(args: {
  sessionId: string
  body: ChatQueueEnqueueBody
}): Promise<ChatQueueItem> {
  const res = await fetch(`${SERVER_BASE}/chat/sessions/${args.sessionId}/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args.body),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to enqueue chat continuation: ${res.status} ${body}`)
  }

  return await res.json() as ChatQueueItem
}

export async function cancelChatSessionQueueItem(args: {
  sessionId: string
  queueItemId: string
}): Promise<ChatQueueItem> {
  const res = await fetch(`${SERVER_BASE}/chat/sessions/${args.sessionId}/queue/${args.queueItemId}`, {
    method: 'DELETE',
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to cancel chat queue item: ${res.status} ${body}`)
  }

  return await res.json() as ChatQueueItem
}

export async function reorderChatSessionQueue(args: {
  sessionId: string
  queueItemIds: string[]
}): Promise<ChatQueueListResponse> {
  const res = await fetch(`${SERVER_BASE}/chat/sessions/${args.sessionId}/queue/reorder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueItemIds: args.queueItemIds }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to reorder chat queue: ${res.status} ${body}`)
  }

  return await res.json() as ChatQueueListResponse
}

export async function cancelChatResponse(sessionId: string): Promise<void> {
  const res = await fetch(`${SERVER_BASE}/chat/sessions/${sessionId}/cancel`, {
    method: 'POST',
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to cancel chat response: ${res.status} ${body}`)
  }
}
