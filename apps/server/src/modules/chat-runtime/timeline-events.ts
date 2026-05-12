// Input: provider kind and timeline event payloads
// Output: typed chat timeline event codecs for chat-runtime persistence
// Position: apps/server/src/modules/chat-runtime/timeline-events.ts

import type { ProviderKind } from '../providers/types'
import type { TimelineInputEvent, TimelineSource } from './runtime-provider-types'

export const TIMELINE_SCHEMA_VERSION = 'cradle.timeline.v1' as const

export type TimelineEventType = TimelineInputEvent['type']

export type StoredTimelineEvent = TimelineInputEvent & {
  id: string
  runId: string
  chatSessionId: string
  sequenceNumber: number
  schemaVersion: typeof TIMELINE_SCHEMA_VERSION
  createdAt: number
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
  const payload = parseJsonRecord(input.payloadJson)
  const source = input.sourceJson ? parseJsonRecord(input.sourceJson) : null
  return parseTimelineInputEvent({
    type: input.eventType,
    ...payload,
    source,
  })
}

function parseTimelineInputEvent(value: unknown): TimelineInputEvent {
  const record = asRecord(value)
  const type = readString(record.type) as TimelineEventType
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
      return { type, itemId: readString(record.itemId), source }
    case 'assistant.text.delta':
    case 'reasoning.delta':
      return { type, itemId: readString(record.itemId), delta: readString(record.delta), source }
    case 'tool_call.started':
      return {
        type,
        itemId: readString(record.itemId),
        toolName: readString(record.toolName),
        toolInput: readOptionalString(record.toolInput),
        source,
      }
    case 'tool_call.input.delta':
      return {
        type,
        itemId: readString(record.itemId),
        delta: readString(record.delta),
        source,
      }
    case 'tool_call.completed':
      return {
        type,
        itemId: readString(record.itemId),
        result: readOptionalString(record.result),
        source,
      }
    case 'command.started':
      return {
        type,
        itemId: readString(record.itemId),
        command: readString(record.command),
        source,
      }
    case 'command.output.delta':
      return {
        type,
        itemId: readString(record.itemId),
        stream: readCommandStream(record.stream),
        delta: readString(record.delta),
        source,
      }
    case 'command.completed':
      return {
        type,
        itemId: readString(record.itemId),
        exitCode: readOptionalNumber(record.exitCode),
        output: readOptionalString(record.output),
        source,
      }
    case 'file_change.started':
      return {
        type,
        itemId: readString(record.itemId),
        paths: readStringArray(record.paths),
        source,
      }
    case 'file_change.completed':
      return {
        type,
        itemId: readString(record.itemId),
        paths: readStringArray(record.paths),
        status: readFileChangeStatus(record.status),
        source,
      }
    case 'run.failed':
      return { type, error: readString(record.error), source }
    default:
      throw new Error(`Unsupported timeline event type: ${String(type)}`)
  }
}

function readSource(value: unknown): TimelineSource {
  const record = asRecord(value)
  return {
    backend: readString(record.backend) as ProviderKind,
    eventType: readString(record.eventType),
    eventId: readOptionalString(record.eventId),
    itemId: readOptionalString(record.itemId),
    metadata: readOptionalRecord(record.metadata) ?? undefined,
  }
}

function parseJsonRecord(value: string): Record<string, unknown> {
  return asRecord(JSON.parse(value))
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Expected object')
  }
  return value as Record<string, unknown>
}

function readString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('Expected non-empty string')
  }
  return value
}

function readOptionalString(value: unknown): string | null | undefined {
  if (value === undefined || value === null) {
    return value as undefined | null
  }
  if (typeof value !== 'string') {
    throw new TypeError('Expected string | null | undefined')
  }
  return value
}

function readOptionalRecord(value: unknown): Record<string, unknown> | null | undefined {
  if (value === undefined || value === null) {
    return value as undefined | null
  }
  return asRecord(value)
}

function readOptionalNumber(value: unknown): number | null | undefined {
  if (value === undefined || value === null) {
    return value as undefined | null
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new TypeError('Expected number | null | undefined')
  }
  return value
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError('Expected string[]')
  }
  return value.map(readString)
}

function readCommandStream(value: unknown): 'stdout' | 'stderr' {
  if (value === 'stdout' || value === 'stderr') {
    return value
  }
  throw new TypeError('Expected command stream stdout | stderr')
}

function readFileChangeStatus(value: unknown): 'completed' | 'failed' {
  if (value === 'completed' || value === 'failed') {
    return value
  }
  throw new TypeError('Expected file change status completed | failed')
}
