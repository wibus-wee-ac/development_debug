// Input: TimelineInputEvent / BackendTimelineEvent (domain-level timeline facts)
// Output: UIMessageChunk[] for real-time broadcast + accumulated UIMessage for persistence
// Position: Single authoritative state machine for one assistant turn's message projection

import type { UIMessage, UIMessageChunk } from 'ai'

import type { BackendTimelineEvent, TimelineInputEvent } from '../backend-control-plane/timeline-events'
import { projectTimelineEventToChatChunks } from '../backend-control-plane/timeline-events'

interface TextPart {
  type: 'text'
  text: string
  state?: 'streaming' | 'done'
}

interface ReasoningPart {
  type: 'reasoning'
  text: string
  state: 'streaming' | 'done'
}

interface ToolPart {
  type: string
  toolName: string
  toolCallId: string
  state:
    | 'input-streaming'
    | 'input-available'
    | 'output-available'
    | 'output-error'
    | 'output-denied'
    | 'approval-requested'
  input?: unknown
  output?: unknown
  errorText?: string
}

export interface TurnStateMachine {
  /** The accumulated UIMessage (mutated in place by apply). */
  readonly message: UIMessage
  /** Apply a timeline event. Returns UIMessageChunks for real-time broadcast to renderer. */
  apply: (event: TimelineInputEvent | BackendTimelineEvent) => UIMessageChunk[]
}

export function createTurnStateMachine(initialMessage: UIMessage): TurnStateMachine {
  const activeTextParts = new Map<string, TextPart>()
  const activeReasoningParts = new Map<string, ReasoningPart>()
  const toolParts = new Map<string, ToolPart>()

  function applyChunks(chunks: UIMessageChunk[]): void {
    for (const chunk of chunks) {
      switch (chunk.type) {
        case 'text-start': {
          if (activeTextParts.has(chunk.id)) {
            break
          }
          const part: TextPart = { type: 'text', text: '', state: 'streaming' }
          activeTextParts.set(chunk.id, part)
          initialMessage.parts.push(part as UIMessage['parts'][number])
          break
        }

        case 'text-delta': {
          const part = ensureTextPart(chunk.id)
          part.text += chunk.delta
          break
        }

        case 'text-end': {
          const part = ensureTextPart(chunk.id)
          part.state = 'done'
          activeTextParts.delete(chunk.id)
          break
        }

        case 'reasoning-start': {
          if (activeReasoningParts.has(chunk.id)) {
            break
          }
          const part: ReasoningPart = { type: 'reasoning', text: '', state: 'streaming' }
          activeReasoningParts.set(chunk.id, part)
          initialMessage.parts.push(part as UIMessage['parts'][number])
          break
        }

        case 'reasoning-delta': {
          const part = ensureReasoningPart(chunk.id)
          part.text += chunk.delta
          break
        }

        case 'reasoning-end': {
          const part = ensureReasoningPart(chunk.id)
          part.state = 'done'
          activeReasoningParts.delete(chunk.id)
          break
        }

        case 'tool-input-start': {
          const part = ensureToolPart(chunk.toolCallId, chunk.toolName)
          part.state = 'input-streaming'
          break
        }

        case 'tool-input-available': {
          const part = ensureToolPart(chunk.toolCallId, chunk.toolName)
          part.state = 'input-available'
          part.input = chunk.input
          break
        }

        case 'tool-output-available': {
          const part = toolParts.get(chunk.toolCallId)
          if (!part) {
            break
          }
          part.state = 'output-available'
          part.output = chunk.output
          break
        }

        case 'tool-output-error': {
          const part = toolParts.get(chunk.toolCallId)
          if (!part) {
            break
          }
          part.state = 'output-error'
          part.errorText = chunk.errorText
          break
        }

        case 'tool-output-denied': {
          const part = toolParts.get(chunk.toolCallId)
          if (!part) {
            break
          }
          part.state = 'output-denied'
          break
        }

        case 'tool-approval-request': {
          const part = toolParts.get(chunk.toolCallId)
          if (!part) {
            break
          }
          part.state = 'approval-requested'
          break
        }

        case 'finish':
        case 'start-step':
        case 'finish-step':
        case 'start':
        case 'message-metadata':
        case 'abort':
        case 'error':
        case 'source-url':
        case 'source-document':
        case 'file':
        case 'tool-input-delta':
          break

        default:
          if ((chunk as { type: string }).type.startsWith('data-')) {
            break
          }
      }
    }
  }

  function ensureTextPart(partId: string): TextPart {
    const existing = activeTextParts.get(partId)
    if (existing) {
      return existing
    }
    const part: TextPart = { type: 'text', text: '', state: 'streaming' }
    activeTextParts.set(partId, part)
    initialMessage.parts.push(part as UIMessage['parts'][number])
    return part
  }

  function ensureReasoningPart(partId: string): ReasoningPart {
    const existing = activeReasoningParts.get(partId)
    if (existing) {
      return existing
    }
    const part: ReasoningPart = { type: 'reasoning', text: '', state: 'streaming' }
    activeReasoningParts.set(partId, part)
    initialMessage.parts.push(part as UIMessage['parts'][number])
    return part
  }

  function ensureToolPart(toolCallId: string, toolName: string): ToolPart {
    const existing = toolParts.get(toolCallId)
    if (existing) {
      return existing
    }
    const part: ToolPart = {
      type: `tool-${toolName}`,
      toolName,
      toolCallId,
      state: 'input-streaming',
    }
    toolParts.set(toolCallId, part)
    initialMessage.parts.push(part as UIMessage['parts'][number])
    return part
  }

  return {
    get message() {
      return initialMessage
    },
    apply(event: TimelineInputEvent | BackendTimelineEvent): UIMessageChunk[] {
      const chunks = projectTimelineEventToChatChunks(event)
      applyChunks(chunks)
      return chunks
    },
  }
}
