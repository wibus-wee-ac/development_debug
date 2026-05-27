// Chat-runtime-owned filesystem trace writer for inspecting provider-to-SSE stream flow.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
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

export function recordChatStreamTrace(input: ChatStreamTraceContext & {
  phase: ChatStreamTracePhase
  payload: unknown
}): void {
  if (!isChatStreamTraceEnabled()) {
    return
  }

  const path = resolveChatStreamTracePath(input.runId)
  mkdirSync(dirname(path), { recursive: true })

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

  appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8')
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
