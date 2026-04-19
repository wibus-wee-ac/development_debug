// Input: AcpConnectionManager (transport), drizzle-orm DB, ai/readUIMessageStream, @shared preferences
// Output: ChatEngine singleton — sole orchestrator for chat sessions; owns transactional
//         session+user+assistant writes, chunk broadcast, debounced DB flush, abort/failure semantics
// Position: Main-process core service (L2) used by ChatService IPC layer

import { randomUUID } from 'node:crypto'

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
import { AcpConnectionManager } from './acp-connection'

// ── Types ─────────────────────────────────────────────────────────────────────

const FLUSH_DEBOUNCE_MS = 200
const FIRST_CHUNK_TIMEOUT_MS = 15_000

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
        const rows = db
          .select()
          .from(sessions)
          .where(eq(sessions.acpSessionId, acpSessionId))
          .all()
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

    const { acpSessionId } = await this.ensureLive(chatSessionId)

    // prepareTurn re-checks the draft map atomically (sync), so any race
    // between this line and the fail-fast guard above is still rejected.
    const draft = this.prepareTurn({
      chatSessionId,
      agentId: session.agent,
      acpSessionId,
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

  async ensureLive(chatSessionId: string): Promise<{ acpSessionId: string }> {
    const session = this.getSessionRow(chatSessionId)
    if (!session) {
      throw new Error(`Chat session ${chatSessionId} not found`)
    }

    const connMgr = AcpConnectionManager.getInstance()

    // Existing ACP session still live?
    if (session.acpSessionId) {
      const state = connMgr.getSessionState(session.agent, session.acpSessionId)
      if (state) {
        return { acpSessionId: session.acpSessionId }
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
        acpSessionId,
        modelId,
        configSnapshot,
        updatedAt: nowUnix(),
      })
      .where(eq(sessions.id, chatSessionId))
      .run()

    return { acpSessionId }
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
            acpSessionId,
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

    // Broadcasts happen after commit so subscribers see durable state
    this.broadcast('chat:message-created', {
      chatSessionId,
      message: {
        id: userMsgId,
        role: 'user',
        status: 'complete',
        content: JSON.stringify(userMessage),
      },
    })
    this.broadcast('chat:message-created', {
      chatSessionId,
      message: {
        id: assistantMsgId,
        role: 'assistant',
        status: 'streaming',
        content: JSON.stringify(assistantMessage),
      },
    })

    return draft
  }

  /**
   * Drive the transport chunk stream for a prepared draft.
   *
   *  - Forwards each chunk to renderer subscribers as `chat:message-chunk`
   *  - Feeds an internal `readUIMessageStream` to maintain the DB snapshot
   *  - On completion / error / cancel: flushes final status, broadcasts
   *    `chat:message-finalized`, clears the draft slot
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

    let firstChunkReceived = false
    const timeoutId = setTimeout(() => {
      if (firstChunkReceived || !this.drafts.has(draft.chatSessionId)) {
        return
      }
      AcpConnectionManager.getInstance()
        .cancel(draft.agentId, draft.acpSessionId)
        .catch(() => {})
    }, FIRST_CHUNK_TIMEOUT_MS)

    let finalStatus: MessageStatus = 'complete'
    let finalError: string | null = null

    try {
      for await (const chunk of AcpConnectionManager.getInstance().prompt(
        draft.agentId,
        draft.acpSessionId,
        userText,
      )) {
        firstChunkReceived = true
        this.broadcast('chat:message-chunk', {
          chatSessionId: draft.chatSessionId,
          messageId: draft.messageId,
          chunk,
        })
        await writer.write(chunk)
      }
      await writer.close()
    }
    catch (err) {
      await writer.abort(err).catch(() => {})
      finalStatus = draft.cancelled ? 'aborted' : 'failed'
      finalError = err instanceof Error ? err.message : String(err)
    }
    finally {
      clearTimeout(timeoutId)
    }

    if (!firstChunkReceived && finalStatus === 'complete') {
      // Stream closed with zero chunks without a user-triggered cancel — timeout
      finalStatus = 'failed'
      finalError = `Agent did not respond within ${FIRST_CHUNK_TIMEOUT_MS / 1000}s`
    }

    await dbTask
    await this.flushNow(draft, finalStatus, finalError)
    this.drafts.delete(draft.chatSessionId)

    this.broadcast('chat:message-finalized', {
      chatSessionId: draft.chatSessionId,
      messageId: draft.messageId,
      status: finalStatus,
      errorText: finalError,
    })
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

  private broadcast(channel: string, payload: unknown): void {
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
