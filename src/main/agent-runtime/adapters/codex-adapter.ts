// Input: Codex SDK ThreadEvent, ThreadItem types
// Output: Pure functions mapping Codex events → TimelineInputEvent
// Position: Adapter layer separating SDK event shapes from internal timeline facts. Testable in isolation.

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

import type { TimelineInputEvent } from '../../backend-control-plane/timeline-events'

const BACKEND = 'codex' as const

// ── Public Adapter ──────────────────────────────────────────────────────────

export interface CodexAdapterState {
  textItemId: string
  assistantStarted: boolean
}

/**
 * Map a Codex ThreadEvent into zero or more TimelineInputEvents.
 * Pure function — no side effects.
 */
export function mapCodexThreadEvent(
  event: ThreadEvent,
  state: CodexAdapterState,
): { events: TimelineInputEvent[], assistantStarted: boolean } {
  switch (event.type) {
    case 'item.started':
      return mapItemEvent(event, state)
    case 'item.updated':
      return mapItemEvent(event, state)
    case 'item.completed':
      return mapItemEvent(event, state)
    case 'thread.started':
    case 'turn.started':
    case 'turn.completed':
    case 'turn.failed':
    case 'error':
      return { events: [], assistantStarted: state.assistantStarted }
  }
}

// ── Private Helpers ─────────────────────────────────────────────────────────

function mapItemEvent(
  event: ItemStartedEvent | ItemUpdatedEvent | ItemCompletedEvent,
  state: CodexAdapterState,
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
    case 'web_search':
    case 'todo_list':
    case 'error':
      return { events: [], assistantStarted }
  }
}

function mapAgentMessage(
  item: AgentMessageItem,
  eventKind: string,
  state: CodexAdapterState,
): { events: TimelineInputEvent[] } {
  const events: TimelineInputEvent[] = []
  // Use SDK-provided item.id for deterministic ID
  const itemId = state.textItemId

  if (!state.assistantStarted) {
    events.push({
      type: 'assistant.message.started',
      itemId,
      source: { backend: BACKEND, eventType: eventKind, itemId },
    })
  }
  if (item.text) {
    events.push({
      type: 'assistant.text.delta',
      itemId,
      delta: item.text,
      source: { backend: BACKEND, eventType: eventKind, itemId },
    })
  }
  return { events }
}

function mapReasoning(
  item: ReasoningItem,
  eventKind: string,
): TimelineInputEvent[] {
  // Use SDK's item.id for deterministic identification
  const itemId = item.id

  if (eventKind === 'item.started') {
    return [{
      type: 'reasoning.started',
      itemId,
      source: { backend: BACKEND, eventType: eventKind, itemId },
    }]
  }
  if (eventKind === 'item.completed') {
    const events: TimelineInputEvent[] = []
    if (item.text) {
      events.push({
        type: 'reasoning.delta',
        itemId,
        delta: item.text,
        source: { backend: BACKEND, eventType: eventKind, itemId },
      })
    }
    events.push({
      type: 'reasoning.completed',
      itemId,
      source: { backend: BACKEND, eventType: eventKind, itemId },
    })
    return events
  }
  // item.updated
  if (item.text) {
    return [{
      type: 'reasoning.delta',
      itemId,
      delta: item.text,
      source: { backend: BACKEND, eventType: eventKind, itemId },
    }]
  }
  return []
}

function mapCommand(
  item: CommandExecutionItem,
  eventKind: string,
): TimelineInputEvent[] {
  const itemId = item.id

  if (eventKind === 'item.started') {
    return [{
      type: 'command.started',
      itemId,
      command: item.command,
      source: { backend: BACKEND, eventType: eventKind, itemId },
    }]
  }
  if (eventKind === 'item.completed') {
    return [{
      type: 'command.completed',
      itemId,
      exitCode: item.exit_code ?? null,
      output: item.aggregated_output || null,
      source: { backend: BACKEND, eventType: eventKind, itemId },
    }]
  }
  // item.updated — stream output delta
  if (item.aggregated_output) {
    return [{
      type: 'command.output.delta',
      itemId,
      stream: 'stdout',
      delta: item.aggregated_output,
      source: { backend: BACKEND, eventType: eventKind, itemId },
    }]
  }
  return []
}

function mapFileChange(
  item: FileChangeItem,
  eventKind: string,
): TimelineInputEvent[] {
  const itemId = item.id
  const paths = item.changes.map(c => c.path)

  if (eventKind === 'item.started') {
    return [{
      type: 'file_change.started',
      itemId,
      paths,
      source: { backend: BACKEND, eventType: eventKind, itemId },
    }]
  }
  return [{
    type: 'file_change.completed',
    itemId,
    paths,
    status: item.status === 'completed' ? 'completed' : 'failed',
    source: { backend: BACKEND, eventType: eventKind, itemId },
  }]
}

function mapMcpToolCall(
  item: McpToolCallItem,
  eventKind: string,
): TimelineInputEvent[] {
  const itemId = item.id

  if (eventKind === 'item.started') {
    return [{
      type: 'tool_call.started',
      itemId,
      toolName: `${item.server}/${item.tool}`,
      toolInput: item.arguments ? JSON.stringify(item.arguments) : null,
      source: { backend: BACKEND, eventType: eventKind, itemId },
    }]
  }
  if (eventKind === 'item.completed') {
    const result = item.result
      ? JSON.stringify(item.result.content)
      : item.error?.message ?? null
    return [{
      type: 'tool_call.completed',
      itemId,
      result,
      source: { backend: BACKEND, eventType: eventKind, itemId },
    }]
  }
  return []
}
