// Chat-runtime-owned filesystem trace writer for inspecting provider-to-SSE stream flow.
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createWriteStream } from 'node:fs'
import { dirname, join } from 'node:path'
import type { WriteStream } from 'node:fs'

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
const streamByRunId = new Map<string, WriteStream>()

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
  return env.NODE_ENV !== 'production' && env.NODE_ENV !== 'test'
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

function getOrCreateStream(runId: string): WriteStream {
  const existing = streamByRunId.get(runId)
  if (existing) {
    return existing
  }

  const path = resolveChatStreamTracePath(runId)
  mkdirSync(dirname(path), { recursive: true })
  const stream = createWriteStream(path, { encoding: 'utf8', flags: 'a' })
  streamByRunId.set(runId, stream)
  return stream
}

function closeStream(runId: string): void {
  const stream = streamByRunId.get(runId)
  if (!stream) {
    return
  }
  streamByRunId.delete(runId)
  traceSeqByRunId.delete(runId)
  stream.end()
}

export function recordChatStreamTrace(input: ChatStreamTraceContext & {
  phase: ChatStreamTracePhase
  payload: unknown
}): void {
  if (!isChatStreamTraceEnabled()) {
    return
  }

  const stream = getOrCreateStream(input.runId)

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
    payload: input.payload,
  }

  stream.write(`${JSON.stringify(record)}\n`)

  if (TERMINAL_PHASES.has(input.phase)) {
    closeStream(input.runId)
  }
}

export function readChatRunTrace(runId: string): ChatRunTrace {
  const path = resolveChatStreamTracePath(runId)
  if (!existsSync(path)) {
    return { runId, path, recordCount: 0, records: [] }
  }

  const content = readFileSync(path, 'utf8')
  const records = content
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => JSON.parse(line) as ChatStreamTraceRecord)

  return { runId, path, recordCount: records.length, records }
}

export function shutdownTraceStreams(): void {
  for (const [runId] of streamByRunId) {
    closeStream(runId)
  }
}
