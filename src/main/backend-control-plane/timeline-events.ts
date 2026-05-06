// Input: ProviderKind from runtime provider types and AI SDK UIMessageChunk projection contract
// Output: Typed timeline event unions, runtime parsers, reducers, and chat projection helpers
// Position: Core event-first model for Cradle-owned backend timeline facts under the backend control-plane owner

import type { UIMessageChunk } from 'ai'

import type { ProviderKind } from '../agent-runtime/runtime-provider-types'
import { projectTimelineEventToChunks } from '../../shared/timeline-projection'

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
    type: 'tool_call.started'
    itemId: string
    toolName: string
    toolInput?: string | null
  })
  | (TimelineEventBase & {
    type: 'tool_call.output.delta'
    itemId: string
    delta: string
  })
  | (TimelineEventBase & {
    type: 'tool_call.completed'
    itemId: string
    result?: string | null
  })
  | (TimelineEventBase & {
    type: 'file_change.started'
    itemId: string
    paths: string[]
  })
  | (TimelineEventBase & {
    type: 'file_change.completed'
    itemId: string
    paths: string[]
    status: 'completed' | 'failed'
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

export function projectTimelineEventToChatChunks(
  event: TimelineInputEvent | BackendTimelineEvent,
): UIMessageChunk[] {
  return projectTimelineEventToChunks(event)
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

    case 'tool_call.started':
      return {
        type,
        itemId: readString(record.itemId, 'itemId'),
        toolName: readString(record.toolName, 'toolName'),
        toolInput: readOptionalString(record.toolInput, 'toolInput'),
        source,
      }

    case 'tool_call.output.delta':
      return {
        type,
        itemId: readString(record.itemId, 'itemId'),
        delta: readString(record.delta, 'delta'),
        source,
      }

    case 'tool_call.completed':
      return {
        type,
        itemId: readString(record.itemId, 'itemId'),
        result: readOptionalString(record.result, 'result'),
        source,
      }

    case 'file_change.started':
      return {
        type,
        itemId: readString(record.itemId, 'itemId'),
        paths: readStringArray(record.paths, 'paths'),
        source,
      }

    case 'file_change.completed': {
      const status = readString(record.status, 'status')
      if (status !== 'completed' && status !== 'failed') {
        throw new Error(`Invalid file_change status: ${status}`)
      }
      return {
        type,
        itemId: readString(record.itemId, 'itemId'),
        paths: readStringArray(record.paths, 'paths'),
        status,
        source,
      }
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

function readStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`Expected ${field} to be an array`)
  }
  return value.map((item, i) => {
    if (typeof item !== 'string') {
      throw new TypeError(`Expected ${field}[${i}] to be a string`)
    }
    return item
  })
}
