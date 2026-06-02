// Output: Mapping from Codex app-server notifications to AI SDK UIMessageChunk events.
// Input: app-server JSON-RPC notifications emitted during a Codex turn.
// Position: Codex runtime provider adapter between the app-server protocol and Chat Runtime.

import type { UIMessageChunk } from 'ai'

import { createBoundedTextCollector, type BoundedTextCollector } from '../bounded-text-collector'
import type { CodexAppServerItem } from './app-server-tool-payload'
import {
  buildCodexServerRequestToolInput,
  buildCodexServerRequestToolOutput,
  buildCodexToolInput,
  buildCodexToolOutput,
  readCodexToolError,
  readCodexToolName,
} from './app-server-tool-payload'

export interface CodexAppServerMapperState {
  openReasoningItemIds: Set<string>
  emittedReasoningTextLengthById: Map<string, number>
  emittedTextLengthById: Map<string, number>
  commandOutputById: Map<string, BoundedTextCollector>
  commandById: Map<string, string>
  toolArgsById: Map<string, unknown>
  startedAgentMessageIds: Set<string>
}

export interface CodexAppServerNotification {
  method?: string
  params?: unknown
}

interface ItemNotificationParams {
  item?: CodexAppServerItem
}

interface DeltaNotificationParams {
  itemId?: string
  delta?: string
}

interface ServerRequestHandledParams {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
}

export function createCodexAppServerMapperState(textItemId: string): CodexAppServerMapperState {
  void textItemId
  return {
    openReasoningItemIds: new Set(),
    emittedReasoningTextLengthById: new Map(),
    emittedTextLengthById: new Map(),
    commandOutputById: new Map(),
    commandById: new Map(),
    toolArgsById: new Map(),
    startedAgentMessageIds: new Set(),
  }
}

export function mapCodexAppServerNotificationToChunks(
  notification: CodexAppServerNotification,
  state: CodexAppServerMapperState,
): UIMessageChunk[] {
  switch (notification.method) {
    case 'item/started':
      return mapStartedItem(getItem(notification), state)
    case 'item/completed':
      return mapCompletedItem(getItem(notification), state)
    case 'item/agentMessage/delta':
      return mapAgentMessageDelta(notification.params, state)
    case 'item/reasoning/textDelta':
    case 'item/reasoning/summaryTextDelta':
      return mapReasoningDelta(notification.params, state)
    case 'command/exec/outputDelta':
    case 'item/commandExecution/outputDelta':
      return mapCommandOutputDelta(notification.params, state)
    case 'item/fileChange/outputDelta':
    case 'item/plan/delta':
    case 'item/mcpToolCall/progress':
      return mapToolProgressDelta(notification.params)
    case 'item/fileChange/patchUpdated':
      return mapFileChangePatchUpdated(notification.params)
    case 'serverRequest/handled':
      return mapHandledServerRequest(notification.params)
    default:
      return []
  }
}

export function closeOpenCodexAppServerReasoning(state: CodexAppServerMapperState): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = []
  for (const itemId of state.openReasoningItemIds) {
    chunks.push({ type: 'reasoning-end', id: itemId })
  }
  state.openReasoningItemIds.clear()
  return chunks
}

export function closeOpenCodexAppServerText(state: CodexAppServerMapperState): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = []
  for (const itemId of state.startedAgentMessageIds) {
    chunks.push({ type: 'text-end', id: itemId })
  }
  state.startedAgentMessageIds.clear()
  return chunks
}

function mapStartedItem(item: CodexAppServerItem | null, state: CodexAppServerMapperState): UIMessageChunk[] {
  if (!item) {
    return []
  }
  switch (item.type) {
    case 'agentMessage':
      return mapAgentMessageSnapshot(item, state)
    case 'reasoning':
      return mapReasoningSnapshot(item, state, false)
    case 'commandExecution':
    case 'fileChange':
    case 'mcpToolCall':
    case 'dynamicToolCall':
    case 'collabAgentToolCall':
    case 'webSearch':
    case 'plan':
    case 'contextCompaction':
      return mapStartedToolItem(item, state)
    default:
      return []
  }
}

function mapStartedToolItem(item: CodexAppServerItem, state: CodexAppServerMapperState): UIMessageChunk[] {
  const toolName = toSafeToolName(readCodexToolName(item))
  const input = buildCodexToolInput(item)
  if (item.type === 'commandExecution') {
    state.commandById.set(item.id, item.command ?? '')
  }
  state.toolArgsById.set(item.id, input.args)
  return [
    ...closeOpenAgentMessageSegments(state),
    { type: 'tool-input-start', toolCallId: item.id, toolName },
    { type: 'tool-input-available', toolCallId: item.id, toolName, input },
  ]
}

function mapCompletedItem(item: CodexAppServerItem | null, state: CodexAppServerMapperState): UIMessageChunk[] {
  if (!item) {
    return []
  }
  switch (item.type) {
    case 'agentMessage':
      return mapAgentMessageSnapshot(item, state)
    case 'reasoning':
      return mapReasoningSnapshot(item, state, true)
    case 'commandExecution':
    case 'fileChange':
    case 'mcpToolCall':
    case 'dynamicToolCall':
    case 'collabAgentToolCall':
    case 'webSearch':
    case 'plan':
    case 'contextCompaction':
      return mapCompletedToolItem(item, state)
    default:
      return []
  }
}

function mapCompletedToolItem(item: CodexAppServerItem, state: CodexAppServerMapperState): UIMessageChunk[] {
  const errorText = readCodexToolError(item)
  if (errorText) {
    return [{ type: 'tool-output-error', toolCallId: item.id, errorText }]
  }
  return [{
    type: 'tool-output-available',
    toolCallId: item.id,
    output: buildCodexToolOutput(
      item,
      state.commandOutputById.get(item.id)?.read(),
      state.commandById.get(item.id),
      state.toolArgsById.get(item.id),
    ),
  }]
}

function mapAgentMessageDelta(rawParams: unknown, state: CodexAppServerMapperState): UIMessageChunk[] {
  const params = rawParams as DeltaNotificationParams
  if (!params.delta || !params.itemId) {
    return []
  }
  state.emittedTextLengthById.set(
    params.itemId,
    (state.emittedTextLengthById.get(params.itemId) ?? 0) + params.delta.length,
  )
  const chunks: UIMessageChunk[] = []
  if (!state.startedAgentMessageIds.has(params.itemId)) {
    state.startedAgentMessageIds.add(params.itemId)
    chunks.push({ type: 'text-start', id: params.itemId })
  }
  chunks.push({ type: 'text-delta', id: params.itemId, delta: params.delta })
  return chunks
}

function mapReasoningDelta(rawParams: unknown, state: CodexAppServerMapperState): UIMessageChunk[] {
  const params = rawParams as DeltaNotificationParams
  if (!params.itemId || !params.delta) {
    return []
  }
  const chunks: UIMessageChunk[] = []
  if (!state.openReasoningItemIds.has(params.itemId)) {
    state.openReasoningItemIds.add(params.itemId)
    chunks.push({ type: 'reasoning-start', id: params.itemId })
  }
  state.emittedReasoningTextLengthById.set(
    params.itemId,
    (state.emittedReasoningTextLengthById.get(params.itemId) ?? 0) + params.delta.length,
  )
  chunks.push({ type: 'reasoning-delta', id: params.itemId, delta: params.delta })
  return chunks
}

function mapCommandOutputDelta(rawParams: unknown, state: CodexAppServerMapperState): UIMessageChunk[] {
  const params = rawParams as DeltaNotificationParams
  if (!params.itemId || !params.delta) {
    return []
  }
  const collector = state.commandOutputById.get(params.itemId) ?? createBoundedTextCollector()
  collector.append(params.delta)
  state.commandOutputById.set(params.itemId, collector)
  return [{ type: 'tool-input-delta', toolCallId: params.itemId, inputTextDelta: params.delta }]
}

function mapToolProgressDelta(rawParams: unknown): UIMessageChunk[] {
  const params = rawParams as { itemId?: string, delta?: string, message?: string }
  const delta = params.delta ?? params.message
  if (!params.itemId || !delta) {
    return []
  }
  return [{ type: 'tool-input-delta', toolCallId: params.itemId, inputTextDelta: delta }]
}

function mapFileChangePatchUpdated(rawParams: unknown): UIMessageChunk[] {
  const params = rawParams as { itemId?: string, changes?: Array<{ path?: string }> }
  if (!params.itemId) {
    return []
  }
  return [{
    type: 'tool-output-available',
    toolCallId: params.itemId,
    preliminary: true,
    output: {
      type: 'cradle.codex.file-change.patch-updated.v1',
      filenames: params.changes?.map(change => change.path).filter(Boolean) ?? [],
      changes: params.changes ?? [],
    },
  }]
}

function mapHandledServerRequest(rawParams: unknown): UIMessageChunk[] {
  const params = rawParams as ServerRequestHandledParams
  if (typeof params.id !== 'number' || !params.method) {
    return []
  }
  const request = { id: params.id, method: params.method, params: params.params }
  const toolCallId = `server-request-${params.id}`
  const toolName = toSafeToolName(`server_request_${params.method}`)
  return [
    { type: 'tool-input-start', toolCallId, toolName },
    {
      type: 'tool-input-available',
      toolCallId,
      toolName,
      input: buildCodexServerRequestToolInput(request),
    },
    {
      type: 'tool-output-available',
      toolCallId,
      output: buildCodexServerRequestToolOutput(request, params.result),
    },
  ]
}

function toSafeToolName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_')
}

function mapAgentMessageSnapshot(item: CodexAppServerItem, state: CodexAppServerMapperState): UIMessageChunk[] {
  const text = item.text ?? ''
  const previousTextLength = state.emittedTextLengthById.get(item.id) ?? 0
  if (text.length <= previousTextLength) {
    if (state.startedAgentMessageIds.delete(item.id)) {
      return [{ type: 'text-end', id: item.id }]
    }
    return []
  }
  const delta = text.slice(previousTextLength)
  const chunks = mapAgentMessageDelta({ itemId: item.id, delta }, state)
  state.startedAgentMessageIds.delete(item.id)
  chunks.push({ type: 'text-end', id: item.id })
  return chunks
}

function mapReasoningSnapshot(
  item: CodexAppServerItem,
  state: CodexAppServerMapperState,
  complete: boolean,
): UIMessageChunk[] {
  const text = mapReasoningSnapshotText(item).join('')
  const previousTextLength = state.emittedReasoningTextLengthById.get(item.id) ?? 0
  const chunks: UIMessageChunk[] = []

  if (text.length > previousTextLength) {
    if (!state.openReasoningItemIds.has(item.id)) {
      state.openReasoningItemIds.add(item.id)
      chunks.push({ type: 'reasoning-start', id: item.id })
    }
    const delta = text.slice(previousTextLength)
    state.emittedReasoningTextLengthById.set(item.id, text.length)
    chunks.push({ type: 'reasoning-delta', id: item.id, delta })
  }

  if (complete && state.openReasoningItemIds.has(item.id)) {
    state.openReasoningItemIds.delete(item.id)
    chunks.push({ type: 'reasoning-end', id: item.id })
  }

  return chunks
}

function mapReasoningSnapshotText(item: CodexAppServerItem): string[] {
  if (item.content?.length) {
    return item.content
  }
  if (item.summary?.length) {
    return item.summary
  }
  return []
}

function getItem(notification: CodexAppServerNotification): CodexAppServerItem | null {
  return ((notification.params as ItemNotificationParams | undefined)?.item ?? null)
}

function closeOpenAgentMessageSegments(state: CodexAppServerMapperState): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = []
  for (const itemId of state.startedAgentMessageIds) {
    chunks.push({ type: 'text-end', id: itemId })
  }
  state.startedAgentMessageIds.clear()
  return chunks
}
