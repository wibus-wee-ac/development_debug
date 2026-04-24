// Input: AgentProfile config and JSONL RPC connection factory for Codex App Server
// Output: CodexAppServerProvider implementing ChatRuntimeProvider for local `codex app-server`
// Position: Concrete Agent Runtime provider for local Codex App Server JSONL stdio integration

import { randomUUID } from 'node:crypto'

import type { ResponseStreamEvent } from '../../lib/chat-provider'
import type {
  AgentProfile,
  CancelTurnInput,
  ChatRuntimeProvider,
  ModelDescriptor,
  ProviderProbeResult,
  ResumeChatSessionInput,
  RuntimeSession,
  StartChatSessionInput,
  StreamTurnInput,
} from '../types'

interface CodexAppServerConfig {
  executable?: string
  args?: string[]
}

/**
 * Wire protocol: Codex App Server communicates over JSONL stdio.
 * Each line is a JSON object (JSON-RPC-like, but without the `jsonrpc` field).
 * Key methods:
 *   - initialize / initialized: capability negotiation
 *   - model/list → { models: ModelObject[] }
 *   - thread/start → { threadId: string } (creates a persistent conversation thread)
 *   - thread/resume → { threadId: string } (resumes an existing thread)
 *   - turn/start(threadId, input[]) → ack, then server pushes notifications
 *   - turn/interrupt(threadId) → cancels the current turn
 * Notifications pushed by server:
 *   - turn/item: { threadId, item: { type, ... } } — content delta for a running turn
 *   - turn/status: { threadId, status: 'running'|'completed'|'cancelled'|'errored' }
 */
export interface CodexRpcClient {
  request: (method: string, params?: unknown) => Promise<unknown>
  notify: (method: string, params?: unknown) => Promise<void>
  onNotification: (method: string, handler: (params: unknown) => void) => () => void
}

export interface CodexAppServerProviderDeps {
  resolveCommand: (executable: string) => string | null
  connect: (profile: AgentProfile) => Promise<CodexRpcClient>
}

interface CodexModelObject {
  id?: unknown
  name?: unknown
  displayName?: unknown
  context_window?: unknown
  contextWindow?: unknown
  hidden?: unknown
}

// Parsed payloads for notifications from the Codex App Server
interface TurnItemPayload {
  threadId?: unknown
  item?: {
    type?: unknown
    text?: unknown
    content?: unknown
  }
}

interface TurnStatusPayload {
  threadId?: unknown
  status?: 'running' | 'completed' | 'cancelled' | 'errored' | string
}

/** Minimal async queue for bridging notification callbacks to an async generator. */
class StreamQueue {
  private readonly buffered: Array<ResponseStreamEvent | null> = []
  private waiter: ((v: ResponseStreamEvent | null) => void) | null = null
  private closed = false

  push(event: ResponseStreamEvent | null): void {
    if (this.closed) {
      return
    }
    if (this.waiter) {
      const resolve = this.waiter
      this.waiter = null
      resolve(event)
    }
    else {
      this.buffered.push(event)
    }
  }

  async next(): Promise<ResponseStreamEvent | null> {
    if (this.buffered.length > 0) {
      return this.buffered.shift()!
    }
    return new Promise((resolve) => {
      this.waiter = resolve
    })
  }

  close(): void {
    // Must resolve/enqueue the null sentinel before setting closed,
    // because push() returns early when this.closed is true.
    if (this.waiter) {
      const resolve = this.waiter
      this.waiter = null
      resolve(null)
    }
    else {
      this.buffered.push(null)
    }
    this.closed = true
  }
}

export class CodexAppServerProvider implements ChatRuntimeProvider {
  readonly providerKind = 'codex-app-server' as const

  /** Active connections keyed by profile id. */
  private readonly connections = new Map<string, Promise<CodexRpcClient>>()

  constructor(private readonly deps: CodexAppServerProviderDeps) {}

  // ── AgentProvider ─────────────────────────────────────────────────────────

  async probe(profile: AgentProfile): Promise<ProviderProbeResult> {
    const config = parseConfig(profile.configJson)
    const executable = config.executable ?? 'codex'
    const resolved = this.deps.resolveCommand(executable)
    if (!resolved) {
      return {
        ok: false,
        label: profile.name,
        version: null,
        details: { executable },
        errorText: `${executable} executable not found`,
      }
    }
    return {
      ok: true,
      label: profile.name,
      version: null,
      details: {
        executable,
        resolvedPath: resolved,
        args: config.args ?? ['app-server'],
      },
      errorText: null,
    }
  }

  async listModels(profile: AgentProfile): Promise<ModelDescriptor[]> {
    try {
      const client = await this.getOrCreateConnection(profile)
      const result = await client.request('model/list', {})
      return readModels(result).map(model => ({
        ...model,
        providerKind: this.providerKind,
      }))
    }
    catch {
      // Codex App Server may not implement model/list; return empty list gracefully
      return []
    }
  }

  // ── ChatRuntimeProvider ───────────────────────────────────────────────────

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    const { chatSessionId, profile, workspacePath, modelId } = input
    const client = await this.getOrCreateConnection(profile)
    const threadParams: Record<string, unknown> = { cwd: workspacePath }
    if (modelId) {
      threadParams.model = modelId
    }
    const result = await client.request('thread/start', threadParams)
    // Response shape: { thread: { id: "thr_123" } }
    const threadId = readThreadId(result) ?? randomUUID()
    return {
      id: chatSessionId,
      chatSessionId,
      agentProfileId: profile.id,
      providerKind: this.providerKind,
      providerSessionId: threadId,
      providerStateSnapshot: null,
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    const { runtimeSession, profile, workspacePath } = input
    const storedThreadId = runtimeSession.providerSessionId
    if (storedThreadId) {
      try {
        const client = await this.getOrCreateConnection(profile)
        const result = await client.request('thread/resume', { threadId: storedThreadId, cwd: workspacePath })
        const resumedThreadId = readThreadId(result) ?? readStringField(result, 'threadId') ?? storedThreadId
        return { ...runtimeSession, providerSessionId: resumedThreadId }
      }
      catch {
        // fall through to start a new thread
      }
    }
    return this.startChatSession({
      chatSessionId: runtimeSession.chatSessionId,
      profile,
      workspacePath,
    })
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<ResponseStreamEvent, void, void> {
    const { runtimeSession, profile, message } = input
    const threadId = runtimeSession.providerSessionId
    if (!threadId) {
      throw new Error('Cannot stream turn: no thread ID in runtime session')
    }

    const client = await this.getOrCreateConnection(profile)
    const queue = new StreamQueue()
    let textItemId: string | null = null
    let outputIndex = 0
    let seqNum = 0

    const nextSeq = (): number => {
      seqNum++
      return seqNum
    }

    // Register notification handlers before sending the request.
    // Real Codex App Server notification methods (from app-server-protocol):
    //   item/started             → ItemStartedNotification  { threadId, turnId, item: ThreadItem }
    //   item/agentMessage/delta  → AgentMessageDeltaNotification { threadId, turnId, itemId, delta }
    //   item/completed           → ItemCompletedNotification { threadId, turnId, item: ThreadItem }
    //   turn/completed           → TurnCompletedNotification { threadId, turn: Turn }
    // (older builds may also send turn/item / turn/status — kept as fallback below)

    const cleanupDelta = client.onNotification('item/agentMessage/delta', (params) => {
      const payload = params as Record<string, unknown>
      if (payload?.threadId !== threadId) {
        return
      }
      const delta = typeof payload.delta === 'string' ? payload.delta : null
      if (delta === null) {
        return
      }
      const itemId = typeof payload.itemId === 'string' ? payload.itemId : randomUUID()
      if (!textItemId) {
        textItemId = itemId
        outputIndex++
        queue.push({
          type: 'response.output_item.added',
          output_index: outputIndex,
          item: {
            type: 'message',
            id: textItemId,
            role: 'assistant',
            status: 'in_progress',
            content: [],
          },
          sequence_number: nextSeq(),
        } as Extract<ResponseStreamEvent, { type: 'response.output_item.added' }>)
      }
      queue.push({
        type: 'response.output_text.delta',
        item_id: textItemId,
        content_index: 0,
        delta,
        logprobs: [],
        output_index: outputIndex,
        sequence_number: nextSeq(),
      } as Extract<ResponseStreamEvent, { type: 'response.output_text.delta' }>)
    })

    const cleanupTurnCompleted = client.onNotification('turn/completed', (params) => {
      const payload = params as { threadId?: unknown }
      if (payload?.threadId !== threadId) {
        return
      }
      if (textItemId) {
        queue.push({
          type: 'response.output_item.done',
          output_index: outputIndex,
          item: {
            type: 'message',
            id: textItemId,
            role: 'assistant',
            status: 'completed',
            content: [],
          },
          sequence_number: nextSeq(),
        } as Extract<ResponseStreamEvent, { type: 'response.output_item.done' }>)
      }
      queue.close()
    })

    // Fallback handlers for older Codex builds that use turn/item + turn/status
    const cleanupItem = client.onNotification('turn/item', (params) => {
      const payload = params as TurnItemPayload
      if (payload?.threadId !== threadId) {
        return
      }
      const item = payload.item
      const text = typeof item?.text === 'string'
        ? item.text
        : typeof item?.content === 'string'
          ? item.content
          : null
      if (text === null || (item?.type !== 'text' && item?.type !== 'output_text' && item?.type !== 'message')) {
        return
      }
      if (!textItemId) {
        textItemId = randomUUID()
        outputIndex++
        queue.push({
          type: 'response.output_item.added',
          output_index: outputIndex,
          item: {
            type: 'message',
            id: textItemId,
            role: 'assistant',
            status: 'in_progress',
            content: [],
          },
          sequence_number: nextSeq(),
        } as Extract<ResponseStreamEvent, { type: 'response.output_item.added' }>)
      }
      queue.push({
        type: 'response.output_text.delta',
        item_id: textItemId,
        content_index: 0,
        delta: text,
        logprobs: [],
        output_index: outputIndex,
        sequence_number: nextSeq(),
      } as Extract<ResponseStreamEvent, { type: 'response.output_text.delta' }>)
    })

    const cleanupStatus = client.onNotification('turn/status', (params) => {
      const payload = params as TurnStatusPayload
      if (payload?.threadId !== threadId) {
        return
      }
      const status = payload.status
      if (status === 'completed' || status === 'cancelled' || status === 'errored') {
        if (textItemId) {
          queue.push({
            type: 'response.output_item.done',
            output_index: outputIndex,
            item: {
              type: 'message',
              id: textItemId,
              role: 'assistant',
              status: 'completed',
              content: [],
            },
            sequence_number: nextSeq(),
          } as Extract<ResponseStreamEvent, { type: 'response.output_item.done' }>)
        }
        queue.close()
      }
    })

    const turnParams: Record<string, unknown> = {
      threadId,
      // Codex App Server input format: array of typed UserInput items
      input: [{ type: 'text', text: message }],
    }
    if (input.thinkingEffort) {
      // Protocol field name is `effort` per TurnStartParams in app-server-protocol
      turnParams.effort = input.thinkingEffort
    }
    try {
      await client.request('turn/start', turnParams)
      while (true) {
        const event = await queue.next()
        if (event === null) {
          break
        }
        yield event
      }
    }
    finally {
      cleanupDelta()
      cleanupTurnCompleted()
      cleanupItem()
      cleanupStatus()
    }
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const { runtimeSession, profile } = input
    const threadId = runtimeSession.providerSessionId
    if (!threadId) {
      return
    }
    try {
      const client = await this.getOrCreateConnection(profile)
      await client.request('turn/interrupt', { threadId })
    }
    catch {
      // cancel errors are non-fatal
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private getOrCreateConnection(profile: AgentProfile): Promise<CodexRpcClient> {
    const cached = this.connections.get(profile.id)
    if (cached) {
      return cached
    }
    const connecting = this.deps.connect(profile)
    this.connections.set(profile.id, connecting)
    connecting.catch(() => {
      this.connections.delete(profile.id)
    })
    return connecting
  }
}

function parseConfig(configJson: string): CodexAppServerConfig {
  try {
    const parsed = JSON.parse(configJson) as CodexAppServerConfig
    return {
      executable: typeof parsed.executable === 'string' ? parsed.executable : undefined,
      args: Array.isArray(parsed.args) ? parsed.args.filter(item => typeof item === 'string') : undefined,
    }
  }
  catch {
    return {}
  }
}

function readStringField(value: unknown, field: string): string | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const candidate = (value as Record<string, unknown>)[field]
  return typeof candidate === 'string' ? candidate : null
}

/** Read thread id from both `{ thread: { id } }` (docs format) and `{ threadId }` (legacy). */
function readThreadId(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const v = value as Record<string, unknown>
  if (v.thread && typeof v.thread === 'object') {
    const thread = v.thread as Record<string, unknown>
    if (typeof thread.id === 'string') {
      return thread.id
    }
  }
  return readStringField(value, 'threadId') ?? readStringField(value, 'id')
}

function readModels(result: unknown): Array<Omit<ModelDescriptor, 'providerKind'>> {
  const value = result as Record<string, unknown>
  // Codex App Server v2 format: { data: [{ id, displayName, ... }] }
  // Legacy format: { models: [{ id, name, ... }] }
  const rawList = Array.isArray(value.data)
    ? value.data
    : Array.isArray(value.models)
      ? value.models
      : []
  return rawList.flatMap((model) => {
    if (typeof model === 'string') {
      return [{ id: model, label: model, contextWindow: null }]
    }
    if (!model || typeof model !== 'object') {
      return []
    }
    const object = model as CodexModelObject
    if (typeof object.id !== 'string') {
      return []
    }
    const contextWindow = typeof object.context_window === 'number'
      ? object.context_window
      : typeof object.contextWindow === 'number'
        ? object.contextWindow
        : null
    const label = typeof object.displayName === 'string'
      ? object.displayName
      : typeof object.name === 'string'
        ? object.name
        : object.id
    return [{
      id: object.id,
      label,
      contextWindow,
    }]
  })
}
