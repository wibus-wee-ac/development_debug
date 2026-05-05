// Input: Raw BackendTimelineEvent[] from DB or live push
// Output: UIMessage[] ready for AI SDK useChat consumption
// Position: Shared pure projector — usable in both main-process and renderer

import type { UIMessage, UIMessageChunk } from 'ai'

// Re-export the chunk projection for renderer use
export type { UIMessageChunk }

/** Minimal timeline event shape needed for projection. */
export interface ProjectableTimelineEvent {
  type: string
  itemId?: string
  delta?: string
  command?: string
  input?: string | null
  output?: string | null
  error?: string
  exitCode?: number | null
  // Persistence metadata (ignored by projector)
  id?: string
  runId?: string
  chatSessionId?: string
  messageId?: string
  sequenceNumber?: number
}

/**
 * Project a single timeline event into UIMessageChunks.
 * Pure function — no side effects, no I/O.
 */
export function projectTimelineEventToChunks(event: ProjectableTimelineEvent): UIMessageChunk[] {
  switch (event.type) {
    case 'assistant.message.started':
      return [{ type: 'text-start', id: event.itemId! }]

    case 'assistant.text.delta':
      return [{ type: 'text-delta', id: event.itemId!, delta: event.delta! }]

    case 'assistant.message.completed':
      return [{ type: 'text-end', id: event.itemId! }]

    case 'reasoning.started':
      return [{ type: 'reasoning-start', id: event.itemId! }]

    case 'reasoning.delta':
      return [{ type: 'reasoning-delta', id: event.itemId!, delta: event.delta! }]

    case 'reasoning.completed':
      return [{ type: 'reasoning-end', id: event.itemId! }]

    case 'command.started': {
      const chunks: UIMessageChunk[] = [{
        type: 'tool-input-start',
        toolCallId: event.itemId!,
        toolName: event.command!,
      }]
      if (event.input) {
        chunks.push({
          type: 'tool-input-available',
          toolCallId: event.itemId!,
          toolName: event.command!,
          input: event.input,
        })
      }
      return chunks
    }

    case 'command.completed': {
      if (!event.output) {
        return []
      }
      return [{
        type: 'tool-output-available',
        toolCallId: event.itemId!,
        output: event.output,
      }]
    }

    case 'run.completed':
    case 'run.aborted':
      return [{ type: 'finish', finishReason: 'stop' }]

    case 'run.started':
    case 'command.output.delta':
    case 'approval.requested':
    case 'approval.resolved':
    case 'run.failed':
      return []

    default:
      return []
  }
}

interface TextPart {
  type: 'text'
  text: string
}

interface ReasoningPart {
  type: 'reasoning'
  text: string
}

interface ToolPart {
  type: string
  toolName: string
  toolCallId: string
  state: string
  input?: unknown
  output?: unknown
  errorText?: string
}

/**
 * Project an ordered array of timeline events into a single UIMessage.
 * This replays the entire event stream to build the final message state.
 * Pure function — no side effects.
 */
export function projectEventsToAssistantMessage(
  messageId: string,
  events: ProjectableTimelineEvent[],
): UIMessage {
  const parts: UIMessage['parts'] = []
  const textParts = new Map<string, TextPart>()
  const reasoningParts = new Map<string, ReasoningPart>()
  const toolParts = new Map<string, ToolPart>()

  for (const event of events) {
    const chunks = projectTimelineEventToChunks(event)

    for (const chunk of chunks) {
      switch (chunk.type) {
        case 'text-start': {
          if (!textParts.has(chunk.id)) {
            const part: TextPart = { type: 'text', text: '' }
            textParts.set(chunk.id, part)
            parts.push(part as UIMessage['parts'][number])
          }
          break
        }
        case 'text-delta': {
          let part = textParts.get(chunk.id)
          if (!part) {
            part = { type: 'text', text: '' }
            textParts.set(chunk.id, part)
            parts.push(part as UIMessage['parts'][number])
          }
          part.text += chunk.delta
          break
        }
        case 'text-end':
          break

        case 'reasoning-start': {
          if (!reasoningParts.has(chunk.id)) {
            const part: ReasoningPart = { type: 'reasoning', text: '' }
            reasoningParts.set(chunk.id, part)
            parts.push(part as UIMessage['parts'][number])
          }
          break
        }
        case 'reasoning-delta': {
          let part = reasoningParts.get(chunk.id)
          if (!part) {
            part = { type: 'reasoning', text: '' }
            reasoningParts.set(chunk.id, part)
            parts.push(part as UIMessage['parts'][number])
          }
          part.text += chunk.delta
          break
        }
        case 'reasoning-end':
          break

        case 'tool-input-start': {
          if (!toolParts.has(chunk.toolCallId)) {
            const part: ToolPart = {
              type: `tool-${chunk.toolName}`,
              toolName: chunk.toolName,
              toolCallId: chunk.toolCallId,
              state: 'input-available',
            }
            toolParts.set(chunk.toolCallId, part)
            parts.push(part as UIMessage['parts'][number])
          }
          break
        }
        case 'tool-input-available': {
          let part = toolParts.get(chunk.toolCallId)
          if (!part) {
            part = {
              type: `tool-${chunk.toolName}`,
              toolName: chunk.toolName,
              toolCallId: chunk.toolCallId,
              state: 'input-available',
            }
            toolParts.set(chunk.toolCallId, part)
            parts.push(part as UIMessage['parts'][number])
          }
          part.state = 'input-available'
          part.input = chunk.input
          break
        }
        case 'tool-output-available': {
          const part = toolParts.get(chunk.toolCallId)
          if (part) {
            part.state = 'output-available'
            part.output = chunk.output
          }
          break
        }
        case 'tool-output-error': {
          const part = toolParts.get(chunk.toolCallId)
          if (part) {
            part.state = 'output-error'
            part.errorText = chunk.errorText
          }
          break
        }
        case 'tool-output-denied': {
          const part = toolParts.get(chunk.toolCallId)
          if (part) {
            part.state = 'output-denied'
          }
          break
        }
        default:
          break
      }
    }
  }

  return { id: messageId, role: 'assistant', parts }
}

/** Grouped events by messageId for multi-message projection. */
export interface MessageTimelineGroup {
  messageId: string
  role: 'user' | 'assistant'
  events: ProjectableTimelineEvent[]
  /** For user messages that have no events, provide the text directly. */
  userText?: string
}

/**
 * Project grouped timeline data into UIMessage[].
 * User messages are reconstructed from text; assistant messages from events.
 */
export function projectGroupsToMessages(groups: MessageTimelineGroup[]): UIMessage[] {
  return groups.map((group) => {
    if (group.role === 'user') {
      return {
        id: group.messageId,
        role: 'user' as const,
        parts: [{ type: 'text' as const, text: group.userText ?? '' }],
      }
    }
    return projectEventsToAssistantMessage(group.messageId, group.events)
  })
}
