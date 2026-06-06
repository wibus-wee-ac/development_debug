import type { FileUIPart, UIMessage } from 'ai'
import { z } from 'zod'

import { getServerUrl } from '~/lib/electron'

import type { ChatContextPart } from './chat-context-parts'

const SERVER_BASE = getServerUrl()

export type ChatThinkingEffort = 'low' | 'medium' | 'high' | 'xhigh'

export interface ChatResponseRequestBody {
  text: string
  files?: FileUIPart[]
  contextParts?: ChatContextPart[]
  messages?: UIMessage[]
  providerTargetId?: string
  modelId?: string
  thinkingEffort?: ChatThinkingEffort
  runtimeSettings?: ChatRuntimeSettingsPatch
}

export type ChatContinuationMode = 'queue' | 'steer'
export type ChatQueueItemStatus = 'pending' | 'running' | 'cancelled' | 'completed' | 'failed'
export type ChatRuntimeAccessMode = 'approval-required' | 'full-access'
export type ChatRuntimeInteractionMode = 'default' | 'plan'

export interface ChatRuntimeSettings {
  accessMode: ChatRuntimeAccessMode
  interactionMode: ChatRuntimeInteractionMode
}

export type ChatRuntimeSettingsPatch = Partial<ChatRuntimeSettings>

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
  thinkingEffort: ChatThinkingEffort | null
  runtimeSettings: ChatRuntimeSettings
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

export type SideContextSource = 'provider-native' | 'cradle-context'

export interface SideChatResult {
  sessionId: string
  parentSessionId: string
  runtimeKind: string
  providerTargetId: string | null
  providerSessionId: string | null
  sideContextSource: SideContextSource
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

const ChatThinkingEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh'])
const ChatRuntimeSettingsSchema = z.object({
  accessMode: z.enum(['approval-required', 'full-access']).default('approval-required'),
  interactionMode: z.enum(['default', 'plan']).default('default'),
})
const ChatQueueItemSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  mode: z.enum(['queue', 'steer']),
  status: z.enum(['pending', 'running', 'cancelled', 'completed', 'failed']),
  text: z.string(),
  files: z.array(z.unknown()).default([]),
  contextParts: z.array(z.unknown()).default([]),
  providerTargetId: z.string().nullable(),
  modelId: z.string().nullable(),
  thinkingEffort: ChatThinkingEffortSchema.nullable().catch(null),
  runtimeSettings: ChatRuntimeSettingsSchema,
  position: z.number(),
  sourceRunId: z.string().nullable(),
  startedRunId: z.string().nullable(),
  errorText: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
}).transform(item => ({
  ...item,
  files: item.files as FileUIPart[],
  contextParts: item.contextParts as ChatContextPart[],
}))
const ChatQueueListResponseSchema = z.object({
  items: z.array(ChatQueueItemSchema),
})

function parseChatQueueItem(value: unknown): ChatQueueItem {
  return ChatQueueItemSchema.parse(value) satisfies ChatQueueItem
}

function parseChatQueueListResponse(value: unknown): ChatQueueListResponse {
  return ChatQueueListResponseSchema.parse(value) satisfies ChatQueueListResponse
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
    runtimeSettings: body.runtimeSettings ?? undefined,
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

export async function createSideChat(args: {
  sessionId: string
  providerTargetId?: string
  modelId?: string
  signal?: AbortSignal
}): Promise<SideChatResult> {
  const res = await fetch(`${SERVER_BASE}/chat/sessions/${args.sessionId}/side-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerTargetId: args.providerTargetId,
      modelId: args.modelId,
    }),
    signal: args.signal,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to create side chat: ${res.status} ${body}`)
  }

  return await res.json() as SideChatResult
}

export async function listChatSessionQueue(sessionId: string): Promise<ChatQueueListResponse> {
  const res = await fetch(`${SERVER_BASE}/chat/sessions/${sessionId}/queue`)

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to list chat queue: ${res.status} ${body}`)
  }

  return parseChatQueueListResponse(await res.json())
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

  return parseChatQueueItem(await res.json())
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

  return parseChatQueueItem(await res.json())
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

  return parseChatQueueListResponse(await res.json())
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
