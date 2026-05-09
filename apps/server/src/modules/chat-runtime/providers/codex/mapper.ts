// Input: Codex SDK ThreadEvent and item types
// Output: Codex thread event -> unified chat timeline mapper
// Position: apps/server/src/modules/chat-runtime/providers/codex/mapper.ts

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

import type { TimelineInputEvent } from '../../runtime-provider-types'

const BACKEND = 'codex' as const

export interface CodexTimelineMapperState {
  textItemId: string
  assistantStarted: boolean
  openReasoningItemId?: string | null
}

export function mapCodexThreadEventToTimeline(
  event: ThreadEvent,
  state: CodexTimelineMapperState,
): { events: TimelineInputEvent[], assistantStarted: boolean } {
  switch (event.type) {
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      return mapItemEvent(event, state)
    default:
      return { events: [], assistantStarted: state.assistantStarted }
  }
}

function mapItemEvent(
  event: ItemStartedEvent | ItemUpdatedEvent | ItemCompletedEvent,
  state: CodexTimelineMapperState,
): { events: TimelineInputEvent[], assistantStarted: boolean } {
  const item = event.item
  let assistantStarted = state.assistantStarted

  switch (item.type) {
    case 'agent_message': {
      const result = mapAgentMessage(item, event.type, state)
      if (result.events.length > 0 && !assistantStarted) {
        assistantStarted = true
      }
      return { events: result.events, assistantStarted }
    }
    case 'reasoning':
      return { events: mapReasoning(item, event.type), assistantStarted }
    case 'command_execution':
      return { events: mapCommand(item, event.type), assistantStarted }
    case 'file_change':
      return { events: mapFileChange(item, event.type), assistantStarted }
    case 'mcp_tool_call':
      return { events: mapMcpToolCall(item, event.type), assistantStarted }
    default:
      return { events: [], assistantStarted }
  }
}

function mapAgentMessage(item: AgentMessageItem, eventType: string, state: CodexTimelineMapperState): { events: TimelineInputEvent[] } {
  const events: TimelineInputEvent[] = []
  const itemId = state.textItemId

  if (!state.assistantStarted) {
    events.push({
      type: 'assistant.message.started',
      itemId,
      source: { backend: BACKEND, eventType, itemId },
    })
  }
  if (item.text) {
    events.push({
      type: 'assistant.text.delta',
      itemId,
      delta: item.text,
      source: { backend: BACKEND, eventType, itemId },
    })
  }
  return { events }
}

function mapReasoning(item: ReasoningItem, eventType: string): TimelineInputEvent[] {
  const itemId = item.id
  if (eventType === 'item.started') {
    const events: TimelineInputEvent[] = [{ type: 'reasoning.started', itemId, source: { backend: BACKEND, eventType, itemId } }]
    if (item.text) {
      events.push({ type: 'reasoning.delta', itemId, delta: item.text, source: { backend: BACKEND, eventType, itemId } })
    }
    return events
  }
  if (eventType === 'item.completed') {
    return [
      ...(item.text ? [{ type: 'reasoning.delta' as const, itemId, delta: item.text, source: { backend: BACKEND, eventType, itemId } }] : []),
      { type: 'reasoning.completed', itemId, source: { backend: BACKEND, eventType, itemId } },
    ]
  }
  return item.text
    ? [{ type: 'reasoning.delta', itemId, delta: item.text, source: { backend: BACKEND, eventType, itemId } }]
    : []
}

function mapCommand(item: CommandExecutionItem, eventType: string): TimelineInputEvent[] {
  const itemId = item.id
  if (eventType === 'item.started') {
    return [{ type: 'command.started', itemId, command: item.command, source: { backend: BACKEND, eventType, itemId } }]
  }
  if (eventType === 'item.completed') {
    return [{
      type: 'command.completed',
      itemId,
      exitCode: item.exit_code ?? null,
      output: item.aggregated_output || null,
      source: { backend: BACKEND, eventType, itemId },
    }]
  }
  return item.aggregated_output
    ? [{ type: 'command.output.delta', itemId, stream: 'stdout', delta: item.aggregated_output, source: { backend: BACKEND, eventType, itemId } }]
    : []
}

function mapFileChange(item: FileChangeItem, eventType: string): TimelineInputEvent[] {
  const itemId = item.id
  const paths = item.changes.map(change => change.path)
  if (eventType === 'item.started') {
    return [{ type: 'file_change.started', itemId, paths, source: { backend: BACKEND, eventType, itemId } }]
  }
  return [{
    type: 'file_change.completed',
    itemId,
    paths,
    status: item.status === 'completed' ? 'completed' : 'failed',
    source: { backend: BACKEND, eventType, itemId },
  }]
}

export function closeOpenCodexReasoning(
  event: ThreadEvent,
  state: CodexTimelineMapperState,
): TimelineInputEvent[] {
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
  return [{
    type: 'reasoning.completed',
    itemId: openReasoningItemId,
    source: { backend: BACKEND, eventType: 'reasoning.auto.completed', itemId: openReasoningItemId },
  }]
}

function mapMcpToolCall(item: McpToolCallItem, eventType: string): TimelineInputEvent[] {
  const itemId = item.id
  if (eventType === 'item.started') {
    return [{
      type: 'tool_call.started',
      itemId,
      toolName: `${item.server}/${item.tool}`,
      toolInput: item.arguments ? JSON.stringify(item.arguments) : null,
      source: { backend: BACKEND, eventType, itemId },
    }]
  }
  if (eventType === 'item.completed') {
    return [{
      type: 'tool_call.completed',
      itemId,
      result: item.result ? JSON.stringify(item.result.content) : item.error?.message ?? null,
      source: { backend: BACKEND, eventType, itemId },
    }]
  }
  return []
}
