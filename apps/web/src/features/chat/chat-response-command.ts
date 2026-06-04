import type { FileUIPart, UIMessage } from 'ai'

import { getServerUrl } from '~/lib/electron'

import type { ChatContextPart } from './chat-context-parts'

const SERVER_BASE = getServerUrl()

export interface ChatResponseRequestBody {
  text: string
  files?: FileUIPart[]
  contextParts?: ChatContextPart[]
  messages?: UIMessage[]
  providerTargetId?: string
  modelId?: string
  thinkingEffort?: 'low' | 'medium' | 'high' | 'xhigh'
  permissionMode?: ChatPermissionMode
}

export type ChatContinuationMode = 'queue' | 'steer'
export type ChatQueueItemStatus = 'pending' | 'running' | 'cancelled' | 'completed' | 'failed'
export type ChatPermissionMode = 'bypassPermissions' | 'plan'

export interface ChatQueueItem {
  id: string
  sessionId: string
  mode: ChatContinuationMode
  status: ChatQueueItemStatus
  text: string
  files: FileUIPart[]
  contextParts: ChatContextPart[]
  providerTargetId: string | null
  modelId: string | null
  thinkingEffort: 'low' | 'medium' | 'high' | 'xhigh' | null
  permissionMode: ChatPermissionMode | null
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

export interface BangCommandResult {
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  timedOut: boolean
  truncated: boolean
  userMessageId: string
  resultMessageId: string
  userMessage: UIMessage
  resultMessage: UIMessage
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
    contextParts: body.contextParts,
    messages: body.messages,
    providerTargetId: body.providerTargetId ?? undefined,
    modelId: body.modelId ?? undefined,
    thinkingEffort: body.thinkingEffort ?? undefined,
    permissionMode: body.permissionMode ?? undefined,
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

export async function subscribeChatSessionStream(args: {
  sessionId: string
  signal?: AbortSignal
}): Promise<Response> {
  const url = new URL(`${SERVER_BASE}/chat/sessions/${args.sessionId}/stream`)
  return fetch(url.toString(), {
    method: 'GET',
    signal: args.signal,
  })
}

export async function executeBangCommand(args: {
  sessionId: string
  command: string
  signal?: AbortSignal
}): Promise<BangCommandResult> {
  const res = await fetch(`${SERVER_BASE}/chat/sessions/${args.sessionId}/bang-command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: args.command }),
    signal: args.signal,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to execute bang command: ${res.status} ${body}`)
  }

  return await res.json() as BangCommandResult
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

export async function switchChatPermissionMode(args: {
  sessionId: string
  mode: ChatPermissionMode
}): Promise<boolean> {
  const res = await fetch(`${SERVER_BASE}/chat/sessions/${args.sessionId}/permission-mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: args.mode }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to switch chat permission mode: ${res.status} ${body}`)
  }

  const result = await res.json() as { ok?: boolean }
  return result.ok === true
}
