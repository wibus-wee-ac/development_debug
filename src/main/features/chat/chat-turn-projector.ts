// Input: typed backend timeline events, chat chunk projection helpers, and AI SDK UIMessage structures
// Output: In-memory assistant-message projector for one chat turn
// Position: Chat feature helper that keeps Cradle's persisted assistant snapshot in lockstep with timeline facts

import type { UIMessage, UIMessageChunk } from 'ai'

import type { BackendTimelineEvent, TimelineInputEvent } from '../backend-control-plane/timeline-events'
import { projectTimelineEventToChatChunks } from '../backend-control-plane/timeline-events'

type ProjectedTextPart = {
  type: 'text'
  text: string
  state?: 'streaming' | 'done'
}

type ProjectedReasoningPart = {
  type: 'reasoning'
  text: string
  state: 'streaming' | 'done'
}

type ProjectedToolPart = {
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

export interface ChatTurnProjector {
  message: UIMessage
  activeTextParts: Map<string, ProjectedTextPart>
  activeReasoningParts: Map<string, ProjectedReasoningPart>
  toolParts: Map<string, ProjectedToolPart>
}

export function createChatTurnProjector(message: UIMessage): ChatTurnProjector {
  return {
    message,
    activeTextParts: new Map<string, ProjectedTextPart>(),
    activeReasoningParts: new Map<string, ProjectedReasoningPart>(),
    toolParts: new Map<string, ProjectedToolPart>(),
  }
}

export function applyTimelineEventToChatTurn(
  projector: ChatTurnProjector,
  event: TimelineInputEvent | BackendTimelineEvent,
): UIMessageChunk[] {
  const chunks = projectTimelineEventToChatChunks(event)
  applyProjectedChunks(projector, chunks)
  return chunks
}

function applyProjectedChunks(projector: ChatTurnProjector, chunks: UIMessageChunk[]): void {
  for (const chunk of chunks) {
    switch (chunk.type) {
      case 'text-start': {
        if (projector.activeTextParts.has(chunk.id)) {
          break
        }
        const part: ProjectedTextPart = {
          type: 'text',
          text: '',
          state: 'streaming',
        }
        projector.activeTextParts.set(chunk.id, part)
        projector.message.parts.push(part as UIMessage['parts'][number])
        break
      }

      case 'text-delta': {
        const part = ensureTextPart(projector, chunk.id)
        part.text += chunk.delta
        break
      }

      case 'text-end': {
        const part = ensureTextPart(projector, chunk.id)
        part.state = 'done'
        projector.activeTextParts.delete(chunk.id)
        break
      }

      case 'reasoning-start': {
        if (projector.activeReasoningParts.has(chunk.id)) {
          break
        }
        const part: ProjectedReasoningPart = {
          type: 'reasoning',
          text: '',
          state: 'streaming',
        }
        projector.activeReasoningParts.set(chunk.id, part)
        projector.message.parts.push(part as UIMessage['parts'][number])
        break
      }

      case 'reasoning-delta': {
        const part = ensureReasoningPart(projector, chunk.id)
        part.text += chunk.delta
        break
      }

      case 'reasoning-end': {
        const part = ensureReasoningPart(projector, chunk.id)
        part.state = 'done'
        projector.activeReasoningParts.delete(chunk.id)
        break
      }

      case 'tool-input-start': {
        const part = ensureToolPart(projector, chunk.toolCallId, chunk.toolName)
        part.state = 'input-streaming'
        break
      }

      case 'tool-input-available': {
        const part = ensureToolPart(projector, chunk.toolCallId, chunk.toolName)
        part.state = 'input-available'
        part.input = chunk.input
        break
      }

      case 'tool-output-available': {
        const part = projector.toolParts.get(chunk.toolCallId)
        if (!part) {
          break
        }
        part.state = 'output-available'
        part.output = chunk.output
        break
      }

      case 'tool-output-error': {
        const part = projector.toolParts.get(chunk.toolCallId)
        if (!part) {
          break
        }
        part.state = 'output-error'
        part.errorText = chunk.errorText
        break
      }

      case 'tool-output-denied': {
        const part = projector.toolParts.get(chunk.toolCallId)
        if (!part) {
          break
        }
        part.state = 'output-denied'
        break
      }

      case 'tool-approval-request': {
        const part = projector.toolParts.get(chunk.toolCallId)
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
        if (chunk.type.startsWith('data-')) {
          break
        }
    }
  }
}

function ensureTextPart(projector: ChatTurnProjector, partId: string): ProjectedTextPart {
  const existing = projector.activeTextParts.get(partId)
  if (existing) {
    return existing
  }
  const part: ProjectedTextPart = {
    type: 'text',
    text: '',
    state: 'streaming',
  }
  projector.activeTextParts.set(partId, part)
  projector.message.parts.push(part as UIMessage['parts'][number])
  return part
}

function ensureReasoningPart(projector: ChatTurnProjector, partId: string): ProjectedReasoningPart {
  const existing = projector.activeReasoningParts.get(partId)
  if (existing) {
    return existing
  }
  const part: ProjectedReasoningPart = {
    type: 'reasoning',
    text: '',
    state: 'streaming',
  }
  projector.activeReasoningParts.set(partId, part)
  projector.message.parts.push(part as UIMessage['parts'][number])
  return part
}

function ensureToolPart(
  projector: ChatTurnProjector,
  toolCallId: string,
  toolName: string,
): ProjectedToolPart {
  const existing = projector.toolParts.get(toolCallId)
  if (existing) {
    return existing
  }
  const part: ProjectedToolPart = {
    type: `tool-${toolName}`,
    toolName,
    toolCallId,
    state: 'input-streaming',
  }
  projector.toolParts.set(toolCallId, part)
  projector.message.parts.push(part as UIMessage['parts'][number])
  return part
}
