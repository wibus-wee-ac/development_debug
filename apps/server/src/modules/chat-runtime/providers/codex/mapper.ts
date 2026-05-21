import type {
  AgentMessageItem,
  CommandExecutionItem,
  FileChangeItem,
  ItemCompletedEvent,
  ItemStartedEvent,
  ItemUpdatedEvent,
  McpToolCallItem,
  ReasoningItem,
  ThreadEvent,
} from '@openai/codex-sdk'
import type { UIMessageChunk } from 'ai'

export interface CodexChunkMapperState {
  textItemId: string
  assistantStarted: boolean
  openReasoningItemId?: string | null
}

export function mapCodexThreadEventToChunks(
  event: ThreadEvent,
  state: CodexChunkMapperState,
): { chunks: UIMessageChunk[], assistantStarted: boolean } {
  switch (event.type) {
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      return mapItemEvent(event, state)
    default:
      return { chunks: [], assistantStarted: state.assistantStarted }
  }
}

function mapItemEvent(
  event: ItemStartedEvent | ItemUpdatedEvent | ItemCompletedEvent,
  state: CodexChunkMapperState,
): { chunks: UIMessageChunk[], assistantStarted: boolean } {
  const item = event.item
  let assistantStarted = state.assistantStarted

  switch (item.type) {
    case 'agent_message': {
      const result = mapAgentMessage(item, state)
      if (result.chunks.length > 0 && !assistantStarted) {
        assistantStarted = true
      }
      return { chunks: result.chunks, assistantStarted }
    }
    case 'reasoning':
      return { chunks: mapReasoning(item, event.type), assistantStarted }
    case 'command_execution':
      return { chunks: mapCommand(item, event.type), assistantStarted }
    case 'file_change':
      return { chunks: mapFileChange(item, event.type), assistantStarted }
    case 'mcp_tool_call':
      return { chunks: mapMcpToolCall(item, event.type), assistantStarted }
    default:
      return { chunks: [], assistantStarted }
  }
}

function mapAgentMessage(item: AgentMessageItem, state: CodexChunkMapperState): { chunks: UIMessageChunk[] } {
  const chunks: UIMessageChunk[] = []
  const itemId = state.textItemId

  if (!state.assistantStarted) {
    chunks.push({ type: 'text-start', id: itemId })
  }
  if (item.text) {
    chunks.push({ type: 'text-delta', id: itemId, delta: item.text })
  }
  return { chunks }
}

function mapReasoning(item: ReasoningItem, eventType: string): UIMessageChunk[] {
  const itemId = item.id
  if (eventType === 'item.started') {
    const chunks: UIMessageChunk[] = [{ type: 'reasoning-start', id: itemId }]
    if (item.text) {
      chunks.push({ type: 'reasoning-delta', id: itemId, delta: item.text })
    }
    return chunks
  }
  if (eventType === 'item.completed') {
    return [
      ...(item.text ? [{ type: 'reasoning-delta' as const, id: itemId, delta: item.text }] : []),
      { type: 'reasoning-end' as const, id: itemId },
    ]
  }
  return item.text
    ? [{ type: 'reasoning-delta', id: itemId, delta: item.text }]
    : []
}

function mapCommand(item: CommandExecutionItem, eventType: string): UIMessageChunk[] {
  // Map command execution to tool calls — commands are essentially tool invocations
  const toolCallId = item.id
  if (eventType === 'item.started') {
    return [
      { type: 'tool-input-start', toolCallId, toolName: 'command_execution' },
      { type: 'tool-input-available', toolCallId, toolName: 'command_execution', input: { command: item.command } },
    ]
  }
  if (eventType === 'item.completed') {
    const output = item.aggregated_output || `exit_code: ${item.exit_code ?? 'unknown'}`
    return [{ type: 'tool-output-available', toolCallId, output }]
  }
  return item.aggregated_output
    ? [{ type: 'tool-input-delta', toolCallId, inputTextDelta: item.aggregated_output }]
    : []
}

function mapFileChange(item: FileChangeItem, eventType: string): UIMessageChunk[] {
  // Map file changes to tool calls
  const toolCallId = item.id
  const paths = item.changes.map(change => change.path)
  if (eventType === 'item.started') {
    return [
      { type: 'tool-input-start', toolCallId, toolName: 'file_change' },
      { type: 'tool-input-available', toolCallId, toolName: 'file_change', input: { paths } },
    ]
  }
  const status = item.status === 'completed' ? 'completed' : 'failed'
  return [{ type: 'tool-output-available', toolCallId, output: JSON.stringify({ paths, status }) }]
}

export function closeOpenCodexReasoning(
  event: ThreadEvent,
  state: CodexChunkMapperState,
): UIMessageChunk[] {
  const openReasoningItemId = state.openReasoningItemId
  if (!openReasoningItemId) {
    return []
  }

  if (event.type === 'item.updated' || event.type === 'item.completed') {
    if (event.item.type === 'reasoning' && event.item.id === openReasoningItemId) {
      return []
    }
  }

  state.openReasoningItemId = null
  return [{ type: 'reasoning-end', id: openReasoningItemId }]
}

function mapMcpToolCall(item: McpToolCallItem, eventType: string): UIMessageChunk[] {
  const toolCallId = item.id
  if (eventType === 'item.started') {
    return [
      { type: 'tool-input-start', toolCallId, toolName: `${item.server}/${item.tool}` },
      ...(item.arguments ? [{ type: 'tool-input-available' as const, toolCallId, toolName: `${item.server}/${item.tool}`, input: item.arguments }] : []),
    ]
  }
  if (eventType === 'item.completed') {
    if (item.error) {
      return [{ type: 'tool-output-error', toolCallId, errorText: item.error.message }]
    }
    return [{ type: 'tool-output-available', toolCallId, output: item.result ? JSON.stringify(item.result.content) : '' }]
  }
  return []
}
