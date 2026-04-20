// Input: AcpConnectionManager (transport), drizzle-orm DB, ai/readUIMessageStream, @shared preferences
// Output: ChatEngine singleton — sole orchestrator for chat sessions; owns transactional
//         session+user+assistant writes, OpenAI-style response-event broadcast, debounced DB flush, abort/failure semantics
// Position: Main-process core service (L2) used by ChatService IPC layer

import { randomUUID } from 'node:crypto'

import { observePush } from '@cradle/ipc'
import {
  applyStoredChatPreferences,
  buildStoredChatPreferencesFromSnapshot,
} from '@shared/chat-preferences'
import type { UIMessage, UIMessageChunk } from 'ai'
import { readUIMessageStream } from 'ai'
import { and, eq, inArray } from 'drizzle-orm'
import type { WebContents } from 'electron'

import { getDb } from '../db'
import type { Message, Session } from '../db/schema'
import { messages, sessions, workspaces } from '../db/schema'
import type { AcpSessionState } from './acp-connection'
import { AcpConnectionManager } from './acp-connection'
import type { ChatResponseEventPayload, ResponseStreamEvent } from './chat-provider'

// ── Types ─────────────────────────────────────────────────────────────────────

const FLUSH_DEBOUNCE_MS = 200

type MessageStatus = 'streaming' | 'complete' | 'aborted' | 'failed'

interface Draft {
  chatSessionId: string
  messageId: string
  agentId: string
  acpSessionId: string
  message: UIMessage
  flushTimer: NodeJS.Timeout | null
  /** User-triggered abort; distinguishes 'aborted' vs 'failed' at finalize time. */
  cancelled: boolean
}

interface CreateAndSendOpts {
  agentId: string
  workspaceId: string
  cwd: string
  text: string
}

export interface ChatMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  status: MessageStatus
  content: string
  errorText: string | null
  createdAt: number
  updatedAt: number
}

export type ChatSessionContinuity = 'active' | 'resumed' | 'loaded' | 'reset'

export interface EnsureLiveResult {
  liveAcpSessionId: string
  continuity: ChatSessionContinuity
}

interface PrepareTurnArgs {
  chatSessionId: string
  agentId: string
  acpSessionId: string
  userText: string
  /** If present, the session row is created as part of the same transaction (first turn). */
  newSession?: {
    workspaceId: string
    title: string
    modelId: string | null
    configSnapshot: string | null
  }
}

interface SerializedChatError {
  text: string
  payload: {
    name?: string
    message: string
    code?: number | string
    data?: unknown
    stack?: string
  }
}

// ── Engine ────────────────────────────────────────────────────────────────────

export class ChatEngine {
  private static instance: ChatEngine
  private readonly drafts = new Map<string, Draft>()
  private readonly subscribers = new Set<WebContents>()
  private titleUnsubscribe: (() => void) | null = null
  private initialized = false

  static getInstance(): ChatEngine {
    if (!ChatEngine.instance) {
      ChatEngine.instance = new ChatEngine()
    }
    return ChatEngine.instance
  }

  /** One-time setup: clean up dangling streaming messages, wire transport hooks. */
  initialize(): void {
    if (this.initialized) {
      return
    }
    this.initialized = true

    // Crash-recovery: any message left in 'streaming' from a previous run is aborted,
    // and the parent session's updatedAt is bumped so the sidebar reflects the last
    // activity time (otherwise a crash can bury a session in the list).
    const db = getDb()
    const strandedSessionIds = db
      .select({ sessionId: messages.sessionId })
      .from(messages)
      .where(eq(messages.status, 'streaming'))
      .all()
      .map(row => row.sessionId)
    const uniqueSessionIds = [...new Set(strandedSessionIds)]

    if (uniqueSessionIds.length > 0) {
      db.transaction((tx) => {
        tx.update(messages)
          .set({
            status: 'aborted',
            errorText: 'Interrupted by app restart',
            updatedAt: nowUnix(),
          })
          .where(eq(messages.status, 'streaming'))
          .run()
        tx.update(sessions)
          .set({ updatedAt: nowUnix() })
          .where(inArray(sessions.id, uniqueSessionIds))
          .run()
      })
    }

    // Forward agent title updates → chat:session-title with chatSessionId mapping.
    this.titleUnsubscribe = AcpConnectionManager.getInstance().onSessionTitle(
      (acpSessionId, title) => {
        const rows = db.select().from(sessions).where(eq(sessions.recoverableAcpSessionId, acpSessionId)).all()
        for (const row of rows) {
          db.update(sessions)
            .set({ title, updatedAt: nowUnix() })
            .where(eq(sessions.id, row.id))
            .run()
          this.broadcast('chat:session-title', { chatSessionId: row.id, title })
        }
      },
    )
  }

  /** Release transport hooks. Primarily useful for tests that rebuild the singleton. */
  destroy(): void {
    if (this.titleUnsubscribe) {
      this.titleUnsubscribe()
      this.titleUnsubscribe = null
    }
    for (const draft of this.drafts.values()) {
      if (draft.flushTimer) {
        clearTimeout(draft.flushTimer)
      }
    }
    this.drafts.clear()
    this.subscribers.clear()
    this.initialized = false
  }

  /** Attach a renderer WebContents to receive chat:* broadcasts. */
  subscribe(wc: WebContents): () => void {
    this.subscribers.add(wc)
    if ('once' in wc) {
      wc.once('destroyed', () => this.subscribers.delete(wc))
    }
    return () => {
      this.subscribers.delete(wc)
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async createAndSend(opts: CreateAndSendOpts): Promise<string> {
    const chatSessionId = randomUUID()
    const { agentId, workspaceId, cwd, text } = opts

    // Boot agent + create ACP session (external calls, before any DB writes)
    await this.ensureAgentRunning(agentId)
    const { acpSessionId, modelId, configSnapshot } = await this.bootstrapAcpSession({
      agentId,
      cwd,
      preferences: null,
    })

    const fallbackTitle = text.length > 50 ? `${text.slice(0, 50)}...` : text

    // Atomic prepare: session row + user (complete) + assistant (streaming) in one tx
    const draft = this.prepareTurn({
      chatSessionId,
      agentId,
      acpSessionId,
      userText: text,
      newSession: {
        workspaceId,
        title: fallbackTitle,
        modelId,
        configSnapshot,
      },
    })

    this.runStream(draft, text).catch((err) => {
      console.error('[ChatEngine] runStream failed (createAndSend):', err)
    })

    return chatSessionId
  }

  async send(chatSessionId: string, text: string): Promise<void> {
    // Fail-fast guard: one in-flight turn per session
    if (this.drafts.has(chatSessionId)) {
      throw new Error(`Chat session ${chatSessionId} already has a turn in progress`)
    }
    const session = this.getSessionRow(chatSessionId)
    if (!session) {
      throw new Error(`Chat session ${chatSessionId} not found`)
    }

    const { liveAcpSessionId } = await this.ensureLive(chatSessionId)

    // prepareTurn re-checks the draft map atomically (sync), so any race
    // between this line and the fail-fast guard above is still rejected.
    const draft = this.prepareTurn({
      chatSessionId,
      agentId: session.agent,
      acpSessionId: liveAcpSessionId,
      userText: text,
    })

    this.runStream(draft, text).catch((err) => {
      console.error('[ChatEngine] runStream failed (send):', err)
    })
  }

  async abort(chatSessionId: string): Promise<void> {
    const draft = this.drafts.get(chatSessionId)
    if (!draft) {
      return
    }
    draft.cancelled = true
    try {
      await AcpConnectionManager.getInstance().cancel(draft.agentId, draft.acpSessionId)
    }
    catch (err) {
      console.warn('[ChatEngine] cancel failed (will still finalize as aborted):', err)
    }
  }

  /**
   * Returns the current messages for a session. Self-heals any row claiming
   * `status='streaming'` that isn't backed by an active in-memory draft — this
   * can happen after a crash, or if the DB lagged the engine for any reason.
   * Also substitutes the live in-memory snapshot for active drafts so the caller
   * always sees the freshest content (not just the last debounced flush).
   */
  getMessages(chatSessionId: string): ChatMessage[] {
    const db = getDb()
    const rows = db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, chatSessionId))
      .orderBy(messages.createdAt)
      .all()
    const activeDraft = this.drafts.get(chatSessionId)

    return rows.map((row) => {
      if (row.status !== 'streaming') {
        return rowToChatMessage(row)
      }
      if (activeDraft && activeDraft.messageId === row.id) {
        return rowToChatMessage({
          ...row,
          content: JSON.stringify(activeDraft.message),
        })
      }
      // Stale streaming row — heal on read so no caller ever sees a zombie status
      db.update(messages)
        .set({
          status: 'aborted',
          errorText: row.errorText ?? 'Interrupted',
          updatedAt: nowUnix(),
        })
        .where(eq(messages.id, row.id))
        .run()
      return rowToChatMessage({
        ...row,
        status: 'aborted',
        errorText: row.errorText ?? 'Interrupted',
      })
    })
  }

  async ensureLive(chatSessionId: string): Promise<EnsureLiveResult> {
    const session = this.getSessionRow(chatSessionId)
    if (!session) {
      throw new Error(`Chat session ${chatSessionId} not found`)
    }

    const connMgr = AcpConnectionManager.getInstance()

    // Existing ACP session still live?
    if (session.recoverableAcpSessionId) {
      const state = connMgr.getSessionState(session.agent, session.recoverableAcpSessionId)
      if (state) {
        return { liveAcpSessionId: session.recoverableAcpSessionId, continuity: 'active' }
      }
    }

    // Need to reconnect — look up cwd from workspace
    const workspace = getDb()
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, session.workspaceId))
      .get()
    const cwd = workspace?.path
    if (!cwd) {
      throw new Error('Workspace path not available for ACP reconnect.')
    }

    await this.ensureAgentRunning(session.agent)

    if (session.recoverableAcpSessionId) {
      const restored = await this.tryRestoreAcpSession({
        agentId: session.agent,
        storedAcpSessionId: session.recoverableAcpSessionId,
        cwd,
        chatSessionId,
      })
      if (restored) {
        return restored
      }
    }

    const { acpSessionId, modelId, configSnapshot } = await this.bootstrapAcpSession({
      agentId: session.agent,
      cwd,
      preferences: buildStoredChatPreferencesFromSnapshot({
        modelId: session.modelId,
        configSnapshot: session.configSnapshot,
      }),
    })

    // Persist the reconnected transport id AND the freshly-observed model/config
    // so the session row stays the sole source of truth for post-reconnect state.
    getDb()
      .update(sessions)
      .set({
        recoverableAcpSessionId: acpSessionId,
        modelId,
        configSnapshot,
        updatedAt: nowUnix(),
      })
      .where(eq(sessions.id, chatSessionId))
      .run()

    return { liveAcpSessionId: acpSessionId, continuity: 'reset' }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async ensureAgentRunning(agentId: string): Promise<void> {
    const connMgr = AcpConnectionManager.getInstance()
    if (connMgr.isConnected(agentId)) {
      return
    }

    const { acpAgents } = await import('../db/schema')
    const record = getDb().select().from(acpAgents).where(eq(acpAgents.id, agentId)).get()
    if (!record || record.status !== 'installed') {
      throw new Error(`Agent not installed or not ready: ${agentId}`)
    }
    await connMgr.connect(agentId, record)
  }

  private async tryRestoreAcpSession(args: {
    agentId: string
    storedAcpSessionId: string
    cwd: string
    chatSessionId: string
  }): Promise<EnsureLiveResult | null> {
    const connMgr = AcpConnectionManager.getInstance()
    const attempts: Array<{
      continuity: Extract<ChatSessionContinuity, 'resumed' | 'loaded'>
      run: () => Promise<{
        models?: AcpSessionState['models'] | null
        configOptions?: AcpSessionState['configOptions'] | null
      }>
    }> = []

    if (connMgr.supportsResumeSession(args.agentId)) {
      attempts.push({
        continuity: 'resumed',
        run: () => connMgr.resumeSession(args.agentId, args.storedAcpSessionId, args.cwd),
      })
    }

    if (connMgr.supportsLoadSession(args.agentId)) {
      attempts.push({
        continuity: 'loaded',
        run: () => connMgr.loadSession(args.agentId, args.storedAcpSessionId, args.cwd),
      })
    }

    for (const attempt of attempts) {
      try {
        const response = await attempt.run()
        this.persistRecoveredSessionState({
          chatSessionId: args.chatSessionId,
          acpSessionId: args.storedAcpSessionId,
          state: {
            models: response.models ?? null,
            configOptions: response.configOptions ?? [],
          },
        })
        return {
          liveAcpSessionId: args.storedAcpSessionId,
          continuity: attempt.continuity,
        }
      }
      catch (error) {
        console.warn(
          `[ChatEngine] ${attempt.continuity} failed for chat ${args.chatSessionId}; falling back if possible`,
          error,
        )
      }
    }

    return null
  }

  private async bootstrapAcpSession(args: {
    agentId: string
    cwd: string
    preferences: ReturnType<typeof buildStoredChatPreferencesFromSnapshot> | null
  }): Promise<{ acpSessionId: string, modelId: string | null, configSnapshot: string | null }> {
    const connMgr = AcpConnectionManager.getInstance()
    const resp = await connMgr.newSession(args.agentId, args.cwd)
    const acpSessionId = resp.sessionId

    const initialState = connMgr.getSessionState(args.agentId, acpSessionId)
    await applyStoredChatPreferences({
      preferences: args.preferences,
      state: initialState,
      setModel: modelId => connMgr.setSessionModel(args.agentId, acpSessionId, modelId),
      setConfigOption: (configId, value) =>
        connMgr.setSessionConfigOption(args.agentId, acpSessionId, configId, value),
    })

    const finalState = connMgr.getSessionState(args.agentId, acpSessionId)
    return {
      acpSessionId,
      modelId: finalState?.models?.currentModelId ?? null,
      configSnapshot: finalState?.configOptions ? JSON.stringify(finalState.configOptions) : null,
    }
  }

  private getSessionRow(chatSessionId: string): Session | undefined {
    return getDb().select().from(sessions).where(eq(sessions.id, chatSessionId)).get()
  }

  private persistRecoveredSessionState(args: {
    chatSessionId: string
    acpSessionId: string
    state: AcpSessionState
  }): void {
    getDb()
      .update(sessions)
      .set({
        recoverableAcpSessionId: args.acpSessionId,
        modelId: args.state.models?.currentModelId ?? null,
        configSnapshot: JSON.stringify(args.state.configOptions ?? []),
        updatedAt: nowUnix(),
      })
      .where(eq(sessions.id, args.chatSessionId))
      .run()
  }

  /**
   * Atomic preparation step for a single turn. All DB writes land in one
   * transaction so we never expose half-initialised sessions or orphan messages.
   * Also claims the chat session's single-in-flight-draft slot (throws if busy).
   *
   * Returns the draft ready for `runStream` to drive.
   */
  private prepareTurn(args: PrepareTurnArgs): Draft {
    const { chatSessionId, agentId, acpSessionId, userText, newSession } = args

    // Atomic single-in-flight-turn claim. JS is single-threaded so this is the
    // authoritative check — any caller that loses the race throws here.
    if (this.drafts.has(chatSessionId)) {
      throw new Error(`Chat session ${chatSessionId} already has a turn in progress`)
    }

    const userMsgId = randomUUID()
    const assistantMsgId = randomUUID()
    const userMessage: UIMessage = {
      id: userMsgId,
      role: 'user',
      parts: [{ type: 'text', text: userText }],
    }
    const assistantMessage: UIMessage = {
      id: assistantMsgId,
      role: 'assistant',
      parts: [],
    }

    const db = getDb()
    db.transaction((tx) => {
      if (newSession) {
        tx.insert(sessions)
          .values({
            id: chatSessionId,
            workspaceId: newSession.workspaceId,
            title: newSession.title,
            agent: agentId,
            recoverableAcpSessionId: acpSessionId,
            modelId: newSession.modelId,
            configSnapshot: newSession.configSnapshot,
          })
          .run()
      }
      tx.insert(messages)
        .values({
          id: userMsgId,
          sessionId: chatSessionId,
          role: 'user',
          status: 'complete',
          content: JSON.stringify(userMessage),
        })
        .run()
      tx.insert(messages)
        .values({
          id: assistantMsgId,
          sessionId: chatSessionId,
          role: 'assistant',
          status: 'streaming',
          content: JSON.stringify(assistantMessage),
        })
        .run()
      if (!newSession) {
        tx.update(sessions)
          .set({ updatedAt: nowUnix() })
          .where(eq(sessions.id, chatSessionId))
          .run()
      }
    })

    const draft: Draft = {
      chatSessionId,
      messageId: assistantMsgId,
      agentId,
      acpSessionId,
      message: assistantMessage,
      flushTimer: null,
      cancelled: false,
    }
    this.drafts.set(chatSessionId, draft)

    return draft
  }

  /**
   * Drive the transport chunk stream for a prepared draft.
   *
   *  - Emits `response.created` before streaming starts
   *  - Broadcasts each `ResponseStreamEvent` on `chat:response-event`
   *  - Feeds an internal `readUIMessageStream` to maintain the DB snapshot
   *  - On completion: broadcasts `response.completed`
   *  - On error/cancel: broadcasts `response.failed` or `response.completed`
   *    (with appropriate status), then clears the draft slot
   */
  private async runStream(draft: Draft, userText: string): Promise<void> {
    const pipe = new TransformStream<UIMessageChunk, UIMessageChunk>()
    const writer = pipe.writable.getWriter()
    const dbTask = (async () => {
      try {
        for await (const snap of readUIMessageStream<UIMessage>({
          message: draft.message,
          stream: pipe.readable,
        })) {
          draft.message = snap
          this.scheduleFlush(draft)
        }
      }
      catch {
        // readUIMessageStream throwing is fine here — main loop handles it
      }
    })()

    let finalStatus: MessageStatus = 'complete'
    let finalError: string | null = null

    // Announce the start of this response turn
    this.broadcastResponseEvent(draft, {
      type: 'response.created',
      sequence_number: 0,
      // `response` below satisfies the shape expected by the renderer
      // (which only reads `type`); not sent to OpenAI, only over local IPC
      response: { id: draft.messageId } as ResponseStreamEvent extends { type: 'response.created', response: infer R } ? R : never,
    } as Extract<ResponseStreamEvent, { type: 'response.created' }>)

    try {
      for await (const event of AcpConnectionManager.getInstance().prompt(
        draft.agentId,
        draft.acpSessionId,
        userText,
      )) {
        this.broadcastResponseEvent(draft, event)
        for (const chunk of responsesEventToUIMessageChunks(event)) {
          await writer.write(chunk)
        }
      }
      await writer.close()
    }
    catch (err) {
      await writer.abort(err).catch(() => {})
      finalStatus = draft.cancelled ? 'aborted' : 'failed'
      const serializedError = serializeChatError(err)
      finalError = serializedError.text

      if (!draft.cancelled) {
        console.error('[ChatEngine] prompt failed', {
          chatSessionId: draft.chatSessionId,
          messageId: draft.messageId,
          agentId: draft.agentId,
          acpSessionId: draft.acpSessionId,
          error: serializedError.payload,
        })
      }
    }

    await dbTask
    await this.flushNow(draft, finalStatus, finalError)
    this.drafts.delete(draft.chatSessionId)

    // Broadcast Turn-end event
    if (finalStatus === 'complete' || finalStatus === 'aborted') {
      this.broadcastResponseEvent(draft, {
        type: 'response.completed',
        sequence_number: 0,
        response: {} as Extract<ResponseStreamEvent, { type: 'response.completed' }>['response'],
      } as Extract<ResponseStreamEvent, { type: 'response.completed' }>)
    }
    else {
      this.broadcastResponseEvent(draft, {
        type: 'response.failed',
        sequence_number: 0,
        response: {
          error: finalError
            ? ({ type: 'server_error', code: 'chat_failed', message: finalError } as unknown as Extract<ResponseStreamEvent, { type: 'response.failed' }>['response']['error'])
            : null,
        } as Extract<ResponseStreamEvent, { type: 'response.failed' }>['response'],
      } as Extract<ResponseStreamEvent, { type: 'response.failed' }>)
    }
  }

  private scheduleFlush(draft: Draft): void {
    if (draft.flushTimer) {
      return
    }
    draft.flushTimer = setTimeout(() => {
      draft.flushTimer = null
      this.persistDraft(draft, 'streaming', null)
    }, FLUSH_DEBOUNCE_MS)
  }

  private async flushNow(
    draft: Draft,
    status: MessageStatus,
    errorText: string | null,
  ): Promise<void> {
    if (draft.flushTimer) {
      clearTimeout(draft.flushTimer)
      draft.flushTimer = null
    }
    this.persistDraft(draft, status, errorText)
  }

  private persistDraft(draft: Draft, status: MessageStatus, errorText: string | null): void {
    const db = getDb()
    db.transaction((tx) => {
      tx.update(messages)
        .set({
          content: JSON.stringify(draft.message),
          status,
          errorText,
          updatedAt: nowUnix(),
        })
        .where(and(eq(messages.id, draft.messageId), eq(messages.sessionId, draft.chatSessionId)))
        .run()
      tx.update(sessions)
        .set({ updatedAt: nowUnix() })
        .where(eq(sessions.id, draft.chatSessionId))
        .run()
    })
  }

  private broadcastResponseEvent(draft: Draft, event: ResponseStreamEvent): void {
    const payload: ChatResponseEventPayload = {
      chatSessionId: draft.chatSessionId,
      messageId: draft.messageId,
      event,
    }
    this.broadcast('chat:response-event', payload as unknown as { chatSessionId: string, [k: string]: unknown })
  }

  private broadcast(
    channel: string,
    payload: { chatSessionId: string, [k: string]: unknown },
  ): void {
    // Surface the push in the IPC devtool feed (single-event trace, grouped by chatSessionId).
    observePush(channel, payload, { flowId: payload.chatSessionId })

    for (const wc of [...this.subscribers]) {
      if (wc.isDestroyed()) {
        this.subscribers.delete(wc)
        continue
      }
      try {
        wc.send(channel, payload)
      }
      catch {
        this.subscribers.delete(wc)
      }
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * Convert a single `ResponseStreamEvent` event into zero or more AI SDK
 * `UIMessageChunk` objects for internal DB-persistence use only.
 *
 * This keeps the existing `readUIMessageStream` pipeline working without
 * any dependency on the IPC wire format.
 */
function responsesEventToUIMessageChunks(event: ResponseStreamEvent): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = []

  switch (event.type) {
    case 'response.output_item.added': {
      if (event.item.type === 'message') {
        chunks.push({ type: 'text-start', id: event.item.id })
      }
      else if (event.item.type === 'function_call') {
        chunks.push({
          type: 'tool-input-start',
          toolCallId: event.item.call_id,
          toolName: event.item.name,
        })
      }
      break
    }
    case 'response.output_text.delta': {
      chunks.push({ type: 'text-delta', id: event.item_id, delta: event.delta })
      break
    }
    case 'response.output_item.done': {
      if (event.item.type === 'message') {
        chunks.push({ type: 'text-end', id: event.item.id })
      }
      else if (event.item.type === 'function_call' && event.item.status === 'completed') {
        // arguments encodes { input, output } as JSON (ACP extension)
        try {
          const decoded = JSON.parse(event.item.arguments) as { input: unknown, output: unknown }
          if (decoded.input !== undefined) {
            chunks.push({
              type: 'tool-input-available',
              toolCallId: event.item.call_id,
              toolName: event.item.name,
              input: typeof decoded.input === 'string' ? decoded.input : JSON.stringify(decoded.input),
            })
          }
          if (decoded.output !== null && decoded.output !== undefined) {
            chunks.push({
              type: 'tool-output-available',
              toolCallId: event.item.call_id,
              output: typeof decoded.output === 'string' ? decoded.output : JSON.stringify(decoded.output),
            })
          }
        }
        catch {
          chunks.push({
            type: 'tool-input-available',
            toolCallId: event.item.call_id,
            toolName: event.item.name,
            input: event.item.arguments,
          })
        }
      }
      break
    }
    case 'response.reasoning_summary_part.added': {
      chunks.push({ type: 'reasoning-start', id: event.item_id })
      break
    }
    case 'response.reasoning_summary_text.delta': {
      chunks.push({ type: 'reasoning-delta', id: event.item_id, delta: event.delta })
      break
    }
    case 'response.reasoning_summary_part.done': {
      chunks.push({ type: 'reasoning-end', id: event.item_id })
      break
    }
    case 'response.completed': {
      chunks.push({
        type: 'finish',
        finishReason: 'stop',
      })
      break
    }
    case 'response.failed': {
      // failure handled at the caller level; no UI chunk needed
      break
    }
    default:
      break
  }

  return chunks
}

function rowToChatMessage(row: Message): ChatMessage {
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role,
    status: row.status,
    content: row.content,
    errorText: row.errorText,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function serializeChatError(error: unknown): SerializedChatError {
  const payload: SerializedChatError['payload'] = {
    message: error instanceof Error ? error.message : String(error),
  }

  if (error instanceof Error) {
    payload.name = error.name
    payload.stack = error.stack
  }

  if (typeof error === 'object' && error !== null) {
    const candidate = error as Record<string, unknown>
    if (typeof candidate.code === 'number' || typeof candidate.code === 'string') {
      payload.code = candidate.code
    }
    if ('data' in candidate) {
      payload.data = candidate.data
    }
  }

  const detailText = formatErrorDetails(payload.data)
  const codePrefix = payload.code !== undefined ? `[code ${String(payload.code)}] ` : ''
  const text = detailText
    ? `${codePrefix}${payload.message}: ${detailText}`
    : `${codePrefix}${payload.message}`

  return { text, payload }
}

function formatErrorDetails(data: unknown): string | null {
  if (data === null || data === undefined) {
    return null
  }

  if (typeof data === 'object' && data !== null && 'details' in data) {
    const details = (data as Record<string, unknown>).details
    return stringifyErrorValue(details)
  }

  return stringifyErrorValue(data)
}

function stringifyErrorValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value)
  }
  catch {
    return String(value)
  }
}
