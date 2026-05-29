// Chat-runtime-owned filesystem trace writer for inspecting provider-to-SSE stream flow.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type ChatStreamTracePhase
  = | 'run_started'
    | 'provider_raw'
    | 'mapper_output'
    | 'runtime_chunk'
    | 'sse_emit'
    | 'run_completed'
    | 'run_failed'
    | 'run_aborted'

export interface ChatStreamTraceContext {
  chatSessionId: string
  runId: string
  messageId: string
  runtimeKind: string
  providerSessionId?: string | null
  toolCallId?: string | null
}

export interface ChatStreamTraceRecord {
  schema: 'cradle.chat-stream-trace.v1'
  seq: number
  phase: ChatStreamTracePhase
  timestamp: number
  chatSessionId: string
  runId: string
  messageId: string
  runtimeKind: string
  providerSessionId: string | null
  toolCallId: string | null
  payload: unknown
}

export interface ChatRunTrace {
  runId: string
  path: string
  recordCount: number
  records: ChatStreamTraceRecord[]
}

const traceSeqByRunId = new Map<string, number>()
const DEFAULT_STRING_LIMIT = 2000
const DEFAULT_ARRAY_LIMIT = 24
const DEFAULT_OBJECT_KEY_LIMIT = 48
const DEFAULT_DEPTH_LIMIT = 8
const DEFAULT_TRACE_READ_LIMIT = 500
const DEFAULT_TRACE_READ_BYTES = 1024 * 1024

const TERMINAL_PHASES: ReadonlySet<ChatStreamTracePhase> = new Set([
  'run_completed',
  'run_failed',
  'run_aborted',
])

export function isChatStreamTraceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CRADLE_CHAT_STREAM_TRACE === '0' || env.CRADLE_CHAT_STREAM_TRACE === 'false') {
    return false
  }
  if (env.CRADLE_CHAT_STREAM_TRACE === '1' || env.CRADLE_CHAT_STREAM_TRACE === 'true') {
    return true
  }
  return false
}

function isFullChatStreamTraceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CRADLE_CHAT_STREAM_TRACE_FULL === '1' || env.CRADLE_CHAT_STREAM_TRACE_FULL === 'true'
}

export function resolveChatStreamTraceDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CRADLE_CHAT_STREAM_TRACE_DIR) {
    return env.CRADLE_CHAT_STREAM_TRACE_DIR
  }
  if (env.CRADLE_DATA_DIR) {
    return join(env.CRADLE_DATA_DIR, 'chat-runtime', 'traces')
  }
  throw new Error('CRADLE_DATA_DIR is required for chat stream trace files')
}

export function resolveChatStreamTracePath(runId: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveChatStreamTraceDir(env), `${encodeURIComponent(runId)}.jsonl`)
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function limitTraceValue(
  value: unknown,
  options: {
    stringLimit: number
    arrayLimit: number
    objectKeyLimit: number
    depthLimit: number
  },
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (typeof value === 'string') {
    if (value.length <= options.stringLimit) {
      return value
    }
    return {
      type: 'cradle.trace-truncated-string.v1',
      originalLength: value.length,
      preview: value.slice(0, options.stringLimit),
    }
  }

  if (
    typeof value === 'number'
    || typeof value === 'boolean'
    || value === null
    || value === undefined
  ) {
    return value
  }

  if (typeof value !== 'object') {
    return String(value)
  }

  if (seen.has(value)) {
    return { type: 'cradle.trace-circular-reference.v1' }
  }
  if (depth >= options.depthLimit) {
    return { type: 'cradle.trace-depth-limit.v1' }
  }

  seen.add(value)
  if (Array.isArray(value)) {
    const items = value
      .slice(0, options.arrayLimit)
      .map(item => limitTraceValue(item, options, depth + 1, seen))
    if (value.length > options.arrayLimit) {
      items.push({
        type: 'cradle.trace-truncated-array.v1',
        omittedCount: value.length - options.arrayLimit,
      })
    }
    return items
  }

  const entries = Object.entries(value)
  const limitedEntries = entries.slice(0, options.objectKeyLimit)
  const record: Record<string, unknown> = {}
  for (const [key, entryValue] of limitedEntries) {
    record[key] = limitTraceValue(entryValue, options, depth + 1, seen)
  }
  if (entries.length > options.objectKeyLimit) {
    record.__traceOmittedKeyCount = entries.length - options.objectKeyLimit
  }
  return record
}

function normalizeTracePayload(payload: unknown): unknown {
  if (isFullChatStreamTraceEnabled()) {
    return payload
  }

  return limitTraceValue(payload, {
    stringLimit: readPositiveInteger(process.env.CRADLE_CHAT_STREAM_TRACE_STRING_LIMIT, DEFAULT_STRING_LIMIT),
    arrayLimit: readPositiveInteger(process.env.CRADLE_CHAT_STREAM_TRACE_ARRAY_LIMIT, DEFAULT_ARRAY_LIMIT),
    objectKeyLimit: readPositiveInteger(process.env.CRADLE_CHAT_STREAM_TRACE_OBJECT_KEY_LIMIT, DEFAULT_OBJECT_KEY_LIMIT),
    depthLimit: readPositiveInteger(process.env.CRADLE_CHAT_STREAM_TRACE_DEPTH_LIMIT, DEFAULT_DEPTH_LIMIT),
  })
}

function closeStream(runId: string): void {
  traceSeqByRunId.delete(runId)
}

export function recordChatStreamTrace(input: ChatStreamTraceContext & {
  phase: ChatStreamTracePhase
  payload: unknown
}): void {
  if (!isChatStreamTraceEnabled()) {
    return
  }

  const seq = traceSeqByRunId.get(input.runId) ?? 0
  traceSeqByRunId.set(input.runId, seq + 1)

  const record: ChatStreamTraceRecord = {
    schema: 'cradle.chat-stream-trace.v1',
    seq,
    phase: input.phase,
    timestamp: Date.now(),
    chatSessionId: input.chatSessionId,
    runId: input.runId,
    messageId: input.messageId,
    runtimeKind: input.runtimeKind,
    providerSessionId: input.providerSessionId ?? null,
    toolCallId: input.toolCallId ?? null,
    payload: normalizeTracePayload(input.payload),
  }

  const path = resolveChatStreamTracePath(input.runId)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8')

  if (TERMINAL_PHASES.has(input.phase)) {
    closeStream(input.runId)
  }
}

export function readChatRunTrace(runId: string): ChatRunTrace {
  const path = resolveChatStreamTracePath(runId)
  if (!existsSync(path)) {
    return { runId, path, recordCount: 0, records: [] }
  }

  const limit = readPositiveInteger(process.env.CRADLE_CHAT_STREAM_TRACE_READ_LIMIT, DEFAULT_TRACE_READ_LIMIT)
  const lines = readTraceTailLines(
    path,
    limit,
    readPositiveInteger(process.env.CRADLE_CHAT_STREAM_TRACE_READ_BYTES, DEFAULT_TRACE_READ_BYTES),
  )
  const records = lines
    .map(line => JSON.parse(line) as ChatStreamTraceRecord)

  return { runId, path, recordCount: records.at(-1) ? records.at(-1)!.seq + 1 : records.length, records }
}

export function shutdownTraceStreams(): void {
  traceSeqByRunId.clear()
}

function readTraceTailLines(path: string, limit: number, readBytes: number): string[] {
  const size = statSync(path).size
  if (size === 0 || limit <= 0) {
    return []
  }

  const fd = openSync(path, 'r')
  try {
    const chunks: Buffer[] = []
    let offset = size
    let newlineCount = 0
    const chunkSize = Math.min(64 * 1024, readBytes)
    let remainingReadBytes = readBytes

    while (offset > 0 && remainingReadBytes > 0 && newlineCount <= limit) {
      const bytesToRead = Math.min(chunkSize, offset, remainingReadBytes)
      offset -= bytesToRead
      remainingReadBytes -= bytesToRead

      const chunk = Buffer.allocUnsafe(bytesToRead)
      const bytesRead = readSync(fd, chunk, 0, bytesToRead, offset)
      const filledChunk = bytesRead === bytesToRead ? chunk : chunk.subarray(0, bytesRead)
      chunks.unshift(filledChunk)

      for (const byte of filledChunk) {
        if (byte === 10) {
          newlineCount += 1
        }
      }
    }

    const text = Buffer.concat(chunks).toString('utf8')
    const allLines = text.split('\n').filter(line => line.length > 0)
    const completeLines = offset > 0 ? allLines.slice(1) : allLines
    return completeLines.slice(Math.max(0, completeLines.length - limit))
  }
  finally {
    closeSync(fd)
  }
}
