// Input: ProviderKind from runtime provider types and AI SDK UIMessageChunk projection contract
// Output: Typed timeline event unions, runtime parsers, reducers, and chat projection helpers
// Position: Core event-first model for Cradle-owned backend timeline facts under the backend control-plane owner

import type { UIMessageChunk } from 'ai'

import type { ProviderKind } from '../agent-runtime/runtime-provider-types'

export const TIMELINE_SCHEMA_VERSION = 'cradle.timeline.v1' as const

export interface TimelineSource {
  backend: ProviderKind
  eventType: string
  eventId?: string | null
  itemId?: string | null
  metadata?: Record<string, unknown>
}

interface TimelineEventBase {
  source: TimelineSource
}

export type TimelineInputEvent
  = (TimelineEventBase & {
    type: 'run.started'
  })
  | (TimelineEventBase & {
    type: 'assistant.message.started'
    itemId: string
  })
  | (TimelineEventBase & {
    type: 'assistant.text.delta'
    itemId: string
    delta: string
  })
  | (TimelineEventBase & {
    type: 'assistant.message.completed'
    itemId: string
  })
  | (TimelineEventBase & {
    type: 'reasoning.started'
    itemId: string
  })
  | (TimelineEventBase & {
    type: 'reasoning.delta'
    itemId: string
    delta: string
  })
  | (TimelineEventBase & {
    type: 'reasoning.completed'
    itemId: string
  })
  | (TimelineEventBase & {
    type: 'command.started'
    itemId: string
    command: string
    input?: string | null
  })
  | (TimelineEventBase & {
    type: 'command.output.delta'
    itemId: string
    stream: 'stdout' | 'stderr'
    delta: string
  })
  | (TimelineEventBase & {
    type: 'command.completed'
    itemId: string
    exitCode: number | null
    output?: string | null
  })
  | (TimelineEventBase & {
    type: 'approval.requested'
    approvalId: string
    prompt: string
  })
  | (TimelineEventBase & {
    type: 'approval.resolved'
    approvalId: string
    decision: 'approved' | 'rejected'
  })
  | (TimelineEventBase & {
    type: 'run.completed'
  })
  | (TimelineEventBase & {
    type: 'run.aborted'
  })
  | (TimelineEventBase & {
    type: 'run.failed'
    error: string
  })

export type TimelineEventType = TimelineInputEvent['type']

export type BackendTimelineEvent = TimelineInputEvent & {
  id: string
  runId: string
  chatSessionId: string
  sequenceNumber: number
  schemaVersion: typeof TIMELINE_SCHEMA_VERSION
  createdAt: number
}

export interface TimelineCommandState {
  command: string
  input: string | null
  stdout: string
  stderr: string
  output: string | null
  status: 'started' | 'completed'
  exitCode: number | null
}

export interface TimelineApprovalState {
  prompt: string | null
  status: 'requested' | 'resolved'
  decision: 'approved' | 'rejected' | null
}

export interface TimelineState {
  runStatus: 'idle' | 'running' | 'complete' | 'aborted' | 'failed'
  assistantText: Record<string, string>
  reasoning: Record<string, string>
  commands: Record<string, TimelineCommandState>
  approvals: Record<string, TimelineApprovalState>
  lastError: string | null
}

export function createTimelineState(): TimelineState {
  return {
    runStatus: 'idle',
    assistantText: {},
    reasoning: {},
    commands: {},
    approvals: {},
    lastError: null,
  }
}

export function reduceTimelineState(
  state: TimelineState = createTimelineState(),
  event: TimelineInputEvent | BackendTimelineEvent,
): TimelineState {
  switch (event.type) {
    case 'run.started':
      return {
        ...state,
        runStatus: 'running',
        lastError: null,
      }

    case 'assistant.message.started':
      return {
        ...state,
        assistantText: {
          ...state.assistantText,
          [event.itemId]: state.assistantText[event.itemId] ?? '',
        },
      }

    case 'assistant.text.delta':
      return {
        ...state,
        assistantText: {
          ...state.assistantText,
          [event.itemId]: `${state.assistantText[event.itemId] ?? ''}${event.delta}`,
        },
      }

    case 'assistant.message.completed':
      return state

    case 'reasoning.started':
      return {
        ...state,
        reasoning: {
          ...state.reasoning,
          [event.itemId]: state.reasoning[event.itemId] ?? '',
        },
      }

    case 'reasoning.delta':
      return {
        ...state,
        reasoning: {
          ...state.reasoning,
          [event.itemId]: `${state.reasoning[event.itemId] ?? ''}${event.delta}`,
        },
      }

    case 'reasoning.completed':
      return state

    case 'command.started':
      return {
        ...state,
        commands: {
          ...state.commands,
          [event.itemId]: {
            command: event.command,
            input: event.input ?? null,
            stdout: '',
            stderr: '',
            output: null,
            status: 'started',
            exitCode: null,
          },
        },
      }

    case 'command.output.delta': {
      const existing = state.commands[event.itemId] ?? {
        command: '',
        input: null,
        stdout: '',
        stderr: '',
        output: null,
        status: 'started' as const,
        exitCode: null,
      }
      return {
        ...state,
        commands: {
          ...state.commands,
          [event.itemId]: {
            ...existing,
            [event.stream]: `${existing[event.stream] ?? ''}${event.delta}`,
          },
        },
      }
    }

    case 'command.completed': {
      const existing = state.commands[event.itemId] ?? {
        command: '',
        input: null,
        stdout: '',
        stderr: '',
        output: null,
        status: 'started' as const,
        exitCode: null,
      }
      return {
        ...state,
        commands: {
          ...state.commands,
          [event.itemId]: {
            ...existing,
            output: event.output ?? existing.output,
            status: 'completed',
            exitCode: event.exitCode,
          },
        },
      }
    }

    case 'approval.requested':
      return {
        ...state,
        approvals: {
          ...state.approvals,
          [event.approvalId]: {
            prompt: event.prompt,
            status: 'requested',
            decision: null,
          },
        },
      }

    case 'approval.resolved': {
      const existing = state.approvals[event.approvalId] ?? {
        prompt: null,
        status: 'requested' as const,
        decision: null,
      }
      return {
        ...state,
        approvals: {
          ...state.approvals,
          [event.approvalId]: {
            ...existing,
            status: 'resolved',
            decision: event.decision,
          },
        },
      }
    }

    case 'run.completed':
      return {
        ...state,
        runStatus: 'complete',
      }

    case 'run.aborted':
      return {
        ...state,
        runStatus: 'aborted',
      }

    case 'run.failed':
      return {
        ...state,
        runStatus: 'failed',
        lastError: event.error,
      }

    default:
      return assertNever(event)
  }
}

export function projectTimelineEventToChatChunks(
  event: TimelineInputEvent | BackendTimelineEvent,
): UIMessageChunk[] {
  switch (event.type) {
    case 'assistant.message.started':
      return [{ type: 'text-start', id: event.itemId }]

    case 'assistant.text.delta':
      return [{ type: 'text-delta', id: event.itemId, delta: event.delta }]

    case 'assistant.message.completed':
      return [{ type: 'text-end', id: event.itemId }]

    case 'reasoning.started':
      return [{ type: 'reasoning-start', id: event.itemId }]

    case 'reasoning.delta':
      return [{ type: 'reasoning-delta', id: event.itemId, delta: event.delta }]

    case 'reasoning.completed':
      return [{ type: 'reasoning-end', id: event.itemId }]

    case 'command.started': {
      const chunks: UIMessageChunk[] = [{
        type: 'tool-input-start',
        toolCallId: event.itemId,
        toolName: event.command,
      }]
      if (event.input) {
        chunks.push({
          type: 'tool-input-available',
          toolCallId: event.itemId,
          toolName: event.command,
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
        toolCallId: event.itemId,
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
      return assertNever(event)
  }
}

export function parseTimelineInputEvent(value: unknown): TimelineInputEvent {
  const record = asRecord(value)
  const type = readString(record.type, 'type') as TimelineEventType
  const source = readSource(record.source)

  switch (type) {
    case 'run.started':
    case 'run.completed':
    case 'run.aborted':
      return { type, source }

    case 'assistant.message.started':
    case 'assistant.message.completed':
    case 'reasoning.started':
    case 'reasoning.completed':
      return {
        type,
        itemId: readString(record.itemId, 'itemId'),
        source,
      }

    case 'assistant.text.delta':
    case 'reasoning.delta':
      return {
        type,
        itemId: readString(record.itemId, 'itemId'),
        delta: readString(record.delta, 'delta'),
        source,
      }

    case 'command.started':
      return {
        type,
        itemId: readString(record.itemId, 'itemId'),
        command: readString(record.command, 'command'),
        input: readOptionalString(record.input, 'input'),
        source,
      }

    case 'command.output.delta': {
      const stream = readString(record.stream, 'stream')
      if (stream !== 'stdout' && stream !== 'stderr') {
        throw new Error(`Invalid timeline stream: ${stream}`)
      }
      return {
        type,
        itemId: readString(record.itemId, 'itemId'),
        stream,
        delta: readString(record.delta, 'delta'),
        source,
      }
    }

    case 'command.completed':
      return {
        type,
        itemId: readString(record.itemId, 'itemId'),
        exitCode: readNullableNumber(record.exitCode, 'exitCode'),
        output: readOptionalString(record.output, 'output'),
        source,
      }

    case 'approval.requested':
      return {
        type,
        approvalId: readString(record.approvalId, 'approvalId'),
        prompt: readString(record.prompt, 'prompt'),
        source,
      }

    case 'approval.resolved': {
      const decision = readString(record.decision, 'decision')
      if (decision !== 'approved' && decision !== 'rejected') {
        throw new Error(`Invalid approval decision: ${decision}`)
      }
      return {
        type,
        approvalId: readString(record.approvalId, 'approvalId'),
        decision,
        source,
      }
    }

    case 'run.failed':
      return {
        type,
        error: readString(record.error, 'error'),
        source,
      }

    default:
      throw new Error(`Unsupported timeline event type: ${String(type)}`)
  }
}

export function encodeTimelineInputEvent(event: TimelineInputEvent): {
  eventType: TimelineEventType
  schemaVersion: typeof TIMELINE_SCHEMA_VERSION
  payloadJson: string
  sourceJson: string
} {
  const { source, ...payload } = event
  return {
    eventType: event.type,
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    payloadJson: JSON.stringify(payload),
    sourceJson: JSON.stringify(source),
  }
}

export function decodeTimelineInputEvent(input: {
  eventType: string
  payloadJson: string
  sourceJson: string | null
}): TimelineInputEvent {
  const payload = parseJsonRecord(input.payloadJson, 'payloadJson')
  const source = input.sourceJson
    ? parseJsonRecord(input.sourceJson, 'sourceJson')
    : null

  return parseTimelineInputEvent({
    type: input.eventType,
    ...payload,
    source,
  })
}

export function getTimelineEventChatStatus(
  event: TimelineInputEvent | BackendTimelineEvent,
): 'streaming' | 'complete' | 'aborted' | 'failed' {
  switch (event.type) {
    case 'run.completed':
      return 'complete'
    case 'run.aborted':
      return 'aborted'
    case 'run.failed':
      return 'failed'
    default:
      return 'streaming'
  }
}

function readSource(value: unknown): TimelineSource {
  const record = asRecord(value)
  return {
    backend: readString(record.backend, 'source.backend') as ProviderKind,
    eventType: readString(record.eventType, 'source.eventType'),
    eventId: readOptionalString(record.eventId, 'source.eventId'),
    itemId: readOptionalString(record.itemId, 'source.itemId'),
    metadata: readOptionalRecord(record.metadata, 'source.metadata') ?? undefined,
  }
}

function parseJsonRecord(value: string, field: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(value), field)
  }
  catch (error) {
    throw new Error(`Invalid ${field}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function asRecord(value: unknown, field = 'value'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`Expected ${field} to be an object`)
  }
  return value as Record<string, unknown>
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`Expected ${field} to be a non-empty string`)
  }
  return value
}

function readOptionalString(value: unknown, field: string): string | null | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value === null) {
    return null
  }
  if (typeof value !== 'string') {
    throw new TypeError(`Expected ${field} to be a string | null | undefined`)
  }
  return value
}

function readNullableNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'number') {
    throw new TypeError(`Expected ${field} to be a number | null`)
  }
  return value
}

function readOptionalRecord(value: unknown, field: string): Record<string, unknown> | null | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value === null) {
    return null
  }
  return asRecord(value, field)
}

function assertNever(value: never): never {
  throw new Error(`Unhandled timeline event: ${JSON.stringify(value)}`)
}
