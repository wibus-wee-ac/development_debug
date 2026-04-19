// Input: Web Crypto randomUUID, @opentelemetry/api SpanStatusCode and context, superjson
// Output: Shared IPC event types, trace envelope helpers, and payload serialization utilities
// Position: Cross-process observability primitives for the shared IPC package

import {
  context as otelContext,
  propagation,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api'
import superjson from 'superjson'

export const IPC_DEVTOOL_METADATA_KEY = '__ipcDevtool'

export type IpcObservedSide = 'renderer' | 'main'
export type IpcObservedPhase = 'start' | 'finish'
export type IpcObservedStatus = 'pending' | 'success' | 'error'

export interface IpcTraceEnvelope {
  [IPC_DEVTOOL_METADATA_KEY]: true
  traceId: string
  spanId: string
  parentSpanId: string | null
  callerStack: string[]
  startedAt: number
}

export interface IpcObservedPayload {
  json: string
  summary: string
  truncated: boolean
}

export interface IpcObservedEvent {
  id: string
  traceId: string
  spanId: string
  parentSpanId: string | null
  channel: string
  side: IpcObservedSide
  phase: IpcObservedPhase
  status: IpcObservedStatus
  startedAt: number
  endedAt: number | null
  durationMs: number | null
  args: IpcObservedPayload | null
  result: IpcObservedPayload | null
  error: IpcObservedPayload | null
  callerStack: string[]
}

export interface SerializeValueOptions {
  maxLength?: number
}

const DEFAULT_MAX_LENGTH = 16_384

function createUuid(): string {
  return globalThis.crypto.randomUUID()
}

export function createTraceEnvelope(
  parentSpanId: string | null = null,
  callerStack: string[] = [],
): IpcTraceEnvelope {
  const traceId = createUuid().replace(/-/g, '')
  const spanId = createUuid().replace(/-/g, '').slice(0, 16)

  const carrier: Record<string, string> = {}
  const spanContext = {
    traceId,
    spanId,
    traceFlags: 1,
    isRemote: false,
  }

  propagation.inject(trace.setSpanContext(ROOT_CONTEXT, spanContext), carrier)

  return {
    [IPC_DEVTOOL_METADATA_KEY]: true,
    traceId: carrier.traceparent?.split('-')[1] ?? traceId,
    spanId: carrier.traceparent?.split('-')[2] ?? spanId,
    parentSpanId,
    callerStack,
    startedAt: Date.now(),
  }
}

export function isTraceEnvelope(value: unknown): value is IpcTraceEnvelope {
  return typeof value === 'object' && value !== null && IPC_DEVTOOL_METADATA_KEY in value
}

export function captureCallerStack(): string[] {
  const stack = new Error().stack ?? ''
  return stack
    .split('\n')
    .slice(2)
    .map(line => line.trim())
    .filter(Boolean)
}

export function serializePayload(
  value: unknown,
  options: SerializeValueOptions = {},
): IpcObservedPayload {
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH
  let json = ''

  try {
    json = superjson.stringify(value)
  }
 catch (error) {
    json = superjson.stringify({
      unserializable: true,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const truncated = json.length > maxLength
  const preview = truncated ? `${json.slice(0, maxLength)}…` : json
  const summary = summarizeValue(value)

  return {
    json: preview,
    summary,
    truncated,
  }
}

export function serializeError(error: unknown): IpcObservedPayload {
  if (error instanceof Error) {
    return serializePayload({
      name: error.name,
      message: error.message,
      stack: error.stack,
    })
  }

  return serializePayload(error)
}

export function createObservedEvent(input: Omit<IpcObservedEvent, 'id'>): IpcObservedEvent {
  return {
    id: createUuid(),
    ...input,
  }
}

export function summarizeValue(value: unknown): string {
  if (value === null) {
    return 'null'
  }
  if (value === undefined) {
    return 'undefined'
  }
  if (Array.isArray(value)) {
    return `Array(${value.length})`
  }
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`
  }
  if (typeof value === 'object') {
    const name = value?.constructor?.name
    if (name && name !== 'Object') {
      return name
    }
    return `Object(${Object.keys(value as Record<string, unknown>).length})`
  }
  if (typeof value === 'string') {
    return value.length > 80 ? `${value.slice(0, 80)}…` : value
  }
  return String(value)
}

export function markSpanSuccess(): void {
  const span = trace.getSpan(otelContext.active())
  span?.setStatus({ code: SpanStatusCode.OK })
  span?.end()
}

export function markSpanError(error: unknown): void {
  const span = trace.getSpan(otelContext.active())
  if (error instanceof Error) {
    span?.recordException(error)
  }
  span?.setStatus({
    code: SpanStatusCode.ERROR,
    message: error instanceof Error ? error.message : String(error),
  })
  span?.end()
}
