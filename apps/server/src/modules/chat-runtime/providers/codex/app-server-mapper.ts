// Output: Mapping from Codex app-server notifications to AI SDK UIMessageChunk events.
// Input: app-server JSON-RPC notifications emitted during a Codex turn.
// Position: Codex runtime provider adapter between the app-server protocol and Chat Runtime.

import type { UIMessageChunk } from 'ai'

export interface CodexAppServerMapperState {
  openReasoningItemIds: Set<string>
  itemTextById: Map<string, string>
  commandOutputById: Map<string, string>
  startedAgentMessageIds: Set<string>
}

export interface CodexAppServerNotification {
  method?: string
  params?: unknown
}

interface AppServerItem {
  type: string
  id: string
  text?: string
  summary?: string[]
  content?: string[]
  command?: string
  aggregatedOutput?: string | null
  exitCode?: number | null
  changes?: Array<{ path: string }>
  status?: string
  server?: string
  tool?: string
  arguments?: unknown
  result?: { content?: unknown } | null
  error?: { message?: string } | null
}

interface ItemNotificationParams {
  item?: AppServerItem
}

interface DeltaNotificationParams {
  itemId?: string
  delta?: string
}

export function createCodexAppServerMapperState(textItemId: string): CodexAppServerMapperState {
  void textItemId
  return {
    openReasoningItemIds: new Set(),
    itemTextById: new Map(),
    commandOutputById: new Map(),
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

function mapStartedItem(item: AppServerItem | null, state: CodexAppServerMapperState): UIMessageChunk[] {
  if (!item) {
    return []
  }
  switch (item.type) {
    case 'agentMessage':
      return mapAgentMessageSnapshot(item, state)
    case 'reasoning':
      state.openReasoningItemIds.add(item.id)
      return [
        { type: 'reasoning-start', id: item.id },
        ...mapReasoningSnapshotText(item).map(delta => ({ type: 'reasoning-delta' as const, id: item.id, delta })),
      ]
    case 'commandExecution':
      return [
        ...closeOpenAgentMessageSegments(state),
        { type: 'tool-input-start', toolCallId: item.id, toolName: 'command_execution' },
        { type: 'tool-input-available', toolCallId: item.id, toolName: 'command_execution', input: { command: item.command ?? '' } },
      ]
    case 'fileChange':
      return [
        ...closeOpenAgentMessageSegments(state),
        { type: 'tool-input-start', toolCallId: item.id, toolName: 'file_change' },
        { type: 'tool-input-available', toolCallId: item.id, toolName: 'file_change', input: { paths: item.changes?.map(change => change.path) ?? [] } },
      ]
    case 'mcpToolCall':
      return [
        ...closeOpenAgentMessageSegments(state),
        { type: 'tool-input-start', toolCallId: item.id, toolName: `${item.server ?? 'mcp'}/${item.tool ?? 'tool'}` },
        ...(item.arguments ? [{ type: 'tool-input-available' as const, toolCallId: item.id, toolName: `${item.server ?? 'mcp'}/${item.tool ?? 'tool'}`, input: item.arguments }] : []),
      ]
    default:
      return []
  }
}

function mapCompletedItem(item: AppServerItem | null, state: CodexAppServerMapperState): UIMessageChunk[] {
  if (!item) {
    return []
  }
  switch (item.type) {
    case 'agentMessage':
      return mapAgentMessageSnapshot(item, state)
    case 'reasoning': {
      const chunks: UIMessageChunk[] = mapReasoningSnapshotText(item).map(delta => ({ type: 'reasoning-delta' as const, id: item.id, delta }))
      if (state.openReasoningItemIds.has(item.id)) {
        state.openReasoningItemIds.delete(item.id)
        chunks.push({ type: 'reasoning-end', id: item.id })
      }
      return chunks
    }
    case 'commandExecution': {
      const output = item.aggregatedOutput ?? state.commandOutputById.get(item.id) ?? `exit_code: ${item.exitCode ?? 'unknown'}`
      return [{ type: 'tool-output-available', toolCallId: item.id, output }]
    }
    case 'fileChange':
      return [{ type: 'tool-output-available', toolCallId: item.id, output: JSON.stringify({ paths: item.changes?.map(change => change.path) ?? [], status: item.status ?? 'completed' }) }]
    case 'mcpToolCall':
      if (item.error?.message) {
        return [{ type: 'tool-output-error', toolCallId: item.id, errorText: item.error.message }]
      }
      return [{ type: 'tool-output-available', toolCallId: item.id, output: item.result?.content ? JSON.stringify(item.result.content) : '' }]
    default:
      return []
  }
}

function mapAgentMessageDelta(rawParams: unknown, state: CodexAppServerMapperState): UIMessageChunk[] {
  const params = rawParams as DeltaNotificationParams
  if (!params.delta || !params.itemId) {
    return []
  }
  const currentText = state.itemTextById.get(params.itemId) ?? ''
  state.itemTextById.set(params.itemId, currentText + params.delta)
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
  chunks.push({ type: 'reasoning-delta', id: params.itemId, delta: params.delta })
  return chunks
}

function mapCommandOutputDelta(rawParams: unknown, state: CodexAppServerMapperState): UIMessageChunk[] {
  const params = rawParams as DeltaNotificationParams
  if (!params.itemId || !params.delta) {
    return []
  }
  const current = state.commandOutputById.get(params.itemId) ?? ''
  state.commandOutputById.set(params.itemId, current + params.delta)
  return [{ type: 'tool-input-delta', toolCallId: params.itemId, inputTextDelta: params.delta }]
}

function mapAgentMessageSnapshot(item: AppServerItem, state: CodexAppServerMapperState): UIMessageChunk[] {
  const text = item.text ?? ''
  const previousText = state.itemTextById.get(item.id) ?? ''
  if (text.length <= previousText.length) {
    if (state.startedAgentMessageIds.delete(item.id)) {
      return [{ type: 'text-end', id: item.id }]
    }
    return []
  }
  const delta = text.slice(previousText.length)
  state.itemTextById.set(item.id, text)
  const chunks = mapAgentMessageDelta({ itemId: item.id, delta }, state)
  state.startedAgentMessageIds.delete(item.id)
  chunks.push({ type: 'text-end', id: item.id })
  return chunks
}

function mapReasoningSnapshotText(item: AppServerItem): string[] {
  if (item.content?.length) {
    return item.content
  }
  if (item.summary?.length) {
    return item.summary
  }
  return []
}

function getItem(notification: CodexAppServerNotification): AppServerItem | null {
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
