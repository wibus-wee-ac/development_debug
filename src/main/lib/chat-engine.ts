// Input: ProviderCatalog (provider dispatch), drizzle-orm DB, ai/readUIMessageStream
// Output: ChatEngine singleton — sole orchestrator for chat sessions; owns transactional
//         session+user+assistant writes, OpenAI-style response-event broadcast, debounced DB flush, abort/failure semantics
// Position: Main-process core service (L2) used by ChatService IPC layer

import { randomUUID } from 'node:crypto'

import { observePush } from '@cradle/ipc'
import type { UIMessage, UIMessageChunk } from 'ai'
import { readUIMessageStream } from 'ai'
import { and, eq, inArray } from 'drizzle-orm'
import type { WebContents } from 'electron'

import { getProviderCatalog } from '../agent-runtime/catalog-instance'
import type { ChatRuntimeProvider, ProviderKind, RuntimeSession as ProviderSession } from '../agent-runtime/types'
import { getDb } from '../db'
import type { Message, Session } from '../db/schema'
import { agentProfiles as agentProfilesTable, agents as agentsTable, messages, sessions, usageLogs, workspaces } from '../db/schema'
import { AcpConnectionManager } from './acp-connection'
import type { ChatResponseEventPayload, ResponseStreamEvent } from './chat-provider'
import { getAgentContextDevtoolStore } from './agent-context-devtool-store'
import { buildSkillCatalog, scanSkills } from './skills'
import { ThreadSearchEngine } from './thread-search'

// ── Types ─────────────────────────────────────────────────────────────────────

const FLUSH_DEBOUNCE_MS = 200

type MessageStatus = 'streaming' | 'complete' | 'aborted' | 'failed'

interface Draft {
  chatSessionId: string
  messageId: string
  userMessageId: string
  agentId: string
  runtimeSession: ProviderSession
  message: UIMessage
  flushTimer: NodeJS.Timeout | null
  /** User-triggered abort; distinguishes 'aborted' vs 'failed' at finalize time. */
  cancelled: boolean
  /** Optional model override for this draft's turns. */
  modelId?: string
  /** Optional reasoning effort for this draft's turns. */
  thinkingEffort?: 'low' | 'medium' | 'high'
}

interface CreateAndSendOpts {
  agentId: string
  workspaceId: string
  cwd: string
  text: string
  modelId?: string
  thinkingEffort?: 'low' | 'medium' | 'high'
  /** Agent identity ID (agents table) — optional, set when chat is started from an Agent. */
  agentIdentityId?: string
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

export interface EnsureLiveResult {
  liveAcpSessionId: string
  continuity: 'active' | 'resumed' | 'reset'
}

interface PrepareTurnArgs {
  chatSessionId: string
  agentId: string
  agentIdentityId?: string
  runtimeSession: ProviderSession
  userText: string
  modelId?: string
  thinkingEffort?: 'low' | 'medium' | 'high'
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
        const rows = db.select().from(sessions).where(eq(sessions.providerSessionId, acpSessionId)).all()
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
    const { agentId, workspaceId, cwd, text, modelId: optsModelId, thinkingEffort } = opts

    const profile = this.loadProfile(agentId)
    const provider = this.getChatProvider(profile.providerKind)

    const runtimeSession = await provider.startChatSession({
      chatSessionId,
      profile,
      workspacePath: cwd,
      modelId: optsModelId,
    })

    const fallbackTitle = text.length > 50 ? `${text.slice(0, 50)}...` : text
    const { modelId, configSnapshot } = extractSessionMeta(runtimeSession.providerStateSnapshot)

    const draft = this.prepareTurn({
      chatSessionId,
      agentId,
      agentIdentityId: opts.agentIdentityId,
      runtimeSession,
      userText: text,
      modelId: optsModelId,
      thinkingEffort,
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

    const profile = this.loadProfile(session.agentProfileId)
    const provider = this.getChatProvider(session.providerKind as ProviderKind)

    const workspace = getDb()
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, session.workspaceId))
      .get()
    const cwd = workspace?.path
    if (!cwd) {
      throw new Error('Workspace path not available')
    }

    const storedSession: ProviderSession = {
      id: session.id,
      chatSessionId: session.id,
      agentProfileId: session.agentProfileId,
      providerKind: session.providerKind as ProviderKind,
      providerSessionId: session.providerSessionId ?? null,
      providerStateSnapshot: session.providerStateSnapshot ?? null,
    }

    const runtimeSession = await provider.resumeChatSession({
      runtimeSession: storedSession,
      profile,
      workspacePath: cwd,
    })

    // Persist any updated session state (e.g., new providerSessionId after reconnect)
    if (runtimeSession.providerSessionId !== session.providerSessionId) {
      getDb()
        .update(sessions)
        .set({
          providerSessionId: runtimeSession.providerSessionId,
          providerStateSnapshot: runtimeSession.providerStateSnapshot,
          updatedAt: nowUnix(),
        })
        .where(eq(sessions.id, chatSessionId))
        .run()
    }

    // prepareTurn re-checks the draft map atomically (sync), so any race
    // between this line and the fail-fast guard above is still rejected.
    const draft = this.prepareTurn({
      chatSessionId,
      agentId: session.agentProfileId,
      runtimeSession,
      userText: text,
      modelId: session.modelId ?? undefined,
    })

    this.runStream(draft, text).catch((err) => {
      console.error('[ChatEngine] runStream failed (send):', err)
    })
  }

  /** Check whether a draft (in-flight turn) exists for the given session. */
  hasDraft(chatSessionId: string): boolean {
    return this.drafts.has(chatSessionId)
  }

  async abort(chatSessionId: string): Promise<void> {
    const draft = this.drafts.get(chatSessionId)
    if (!draft) {
      return
    }
    draft.cancelled = true
    try {
      const profile = this.loadProfile(draft.agentId)
      const provider = this.getChatProvider(profile.providerKind)
      await provider.cancelTurn({ runtimeSession: draft.runtimeSession, profile })
    }
    catch (err) {
      console.warn('[ChatEngine] cancel failed (will still finalize as aborted):', err)
    }
  }

  /**
   * Ensures the provider session for a chat session is live (reconnecting if needed).
   * Returns the live provider session ID for ACP model/config pickers.
   */
  async ensureLive(chatSessionId: string): Promise<EnsureLiveResult> {
    const session = this.getSessionRow(chatSessionId)
    if (!session) {
      throw new Error(`Chat session ${chatSessionId} not found`)
    }

    // If there's already a stored provider session ID, try to verify/resume it
    if (session.providerSessionId) {
      return { liveAcpSessionId: session.providerSessionId, continuity: 'active' }
    }

    // No session ID — need to reconnect via the provider
    const workspace = getDb()
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, session.workspaceId))
      .get()
    const cwd = workspace?.path
    if (!cwd) {
      throw new Error('Workspace path not available for session reconnect.')
    }

    const profile = this.loadProfile(session.agentProfileId)
    const provider = this.getChatProvider(session.providerKind as ProviderKind)
    const storedSession: ProviderSession = {
      id: session.id,
      chatSessionId: session.id,
      agentProfileId: session.agentProfileId,
      providerKind: session.providerKind as ProviderKind,
      providerSessionId: null,
      providerStateSnapshot: session.providerStateSnapshot ?? null,
    }
    const resumed = await provider.resumeChatSession({ runtimeSession: storedSession, profile, workspacePath: cwd })
    const liveSessionId = resumed.providerSessionId ?? chatSessionId

    getDb()
      .update(sessions)
      .set({ providerSessionId: liveSessionId, updatedAt: nowUnix() })
      .where(eq(sessions.id, chatSessionId))
      .run()

    return { liveAcpSessionId: liveSessionId, continuity: 'reset' }
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

  // ── Internals ─────────────────────────────────────────────────────────────

  private loadProfile(agentId: string) {
    const profile = getDb().select().from(agentProfilesTable).where(eq(agentProfilesTable.id, agentId)).get()
    if (!profile || !profile.enabled) {
      throw new Error(`Agent profile not found or not enabled: ${agentId}`)
    }
    return profile
  }

  private getChatProvider(providerKind: string): ChatRuntimeProvider {
    const catalog = getProviderCatalog()
    const provider = catalog.get(providerKind as ProviderKind)
    if (!('startChatSession' in provider)) {
      throw new Error(`Provider ${providerKind} does not support chat sessions`)
    }
    return provider as ChatRuntimeProvider
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
    const { chatSessionId, agentId, agentIdentityId, runtimeSession, userText, newSession, modelId, thinkingEffort } = args

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
            agentProfileId: agentId,
            agentId: agentIdentityId ?? null,
            providerKind: runtimeSession.providerKind,
            providerSessionId: runtimeSession.providerSessionId,
            providerStateSnapshot: runtimeSession.providerStateSnapshot,
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
      userMessageId: userMsgId,
      agentId,
      runtimeSession,
      message: assistantMessage,
      flushTimer: null,
      cancelled: false,
      modelId,
      thinkingEffort,
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
    let provider: ChatRuntimeProvider | null = null

    // Announce the start of this response turn
    this.broadcastResponseEvent(draft, {
      type: 'response.created',
      sequence_number: 0,
      // `response` below satisfies the shape expected by the renderer
      // (which only reads `type`); not sent to OpenAI, only over local IPC
      response: { id: draft.messageId } as ResponseStreamEvent extends { type: 'response.created', response: infer R } ? R : never,
    } as Extract<ResponseStreamEvent, { type: 'response.created' }>)

    try {
      const profile = this.loadProfile(draft.agentId)
      provider = this.getChatProvider(profile.providerKind)

      // ── Assemble conversation context (history + system prompt) ──────────
      let systemPrompt: string | undefined
      let history: Array<{ role: 'user' | 'assistant', content: string }> | undefined
      let agentName: string | null = null
      let skillEntries: ReturnType<typeof scanSkills> = []

      const db = getDb()
      const session = db.select().from(sessions).where(eq(sessions.id, draft.chatSessionId)).get()

      // Load Agent identity info (name + system prompt) for all providers
      if (session?.agentId) {
        const agent = db.select().from(agentsTable).where(eq(agentsTable.id, session.agentId)).get()
        agentName = agent?.name ?? null
        if (agent?.configJson) {
          try {
            const cfg = JSON.parse(agent.configJson)
            if (typeof cfg.systemPrompt === 'string' && cfg.systemPrompt.length > 0) {
              systemPrompt = cfg.systemPrompt
            }
          }
          catch {
            // Invalid JSON in configJson — ignore
          }
        }
      }

      // For ACP providers, fall back to deriving name from agentId
      if (profile.providerKind === 'acp-chat' && !agentName && draft.agentId) {
        agentName = draft.agentId.replace(/^acp:/, '')
      }

      // Load history + skills only for providers that need it (not ACP — it manages its own state)
      if (profile.providerKind !== 'acp-chat') {
        // Load conversation history (exclude current turn's user + assistant messages)
        const rows = db.select()
          .from(messages)
          .where(and(
            eq(messages.sessionId, draft.chatSessionId),
            eq(messages.status, 'complete'),
          ))
          .orderBy(messages.createdAt)
          .all()
          .filter(row => row.id !== draft.userMessageId && row.id !== draft.messageId)

        if (rows.length > 0) {
          history = rows.map((row) => {
            let text = ''
            try {
              const uiMsg: UIMessage = JSON.parse(row.content)
              text = uiMsg.parts
                .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
                .map(p => p.text)
                .join('\n')
            }
            catch {
              text = row.content
            }
            return { role: row.role as 'user' | 'assistant', content: text }
          })
        }

        // Scan skills and append catalog to system prompt
        const workspace = session?.workspaceId
          ? db.select().from(workspaces).where(eq(workspaces.id, session.workspaceId)).get()
          : undefined
        const skillEntries_ = scanSkills(workspace?.path)
        skillEntries = skillEntries_
        const catalog = buildSkillCatalog(skillEntries_)
        if (catalog) {
          systemPrompt = (systemPrompt ?? '') + catalog
        }
      }

      // Record agent context for devtool observability (all providers)
      getAgentContextDevtoolStore().record({
        id: randomUUID(),
        timestamp: Date.now(),
        chatSessionId: draft.chatSessionId,
        agentId: draft.agentId ?? null,
        agentName,
        systemPrompt: systemPrompt ?? null,
        skillsCatalog: skillEntries,
        historyLength: history?.length ?? 0,
        providerKind: profile.providerKind,
      })

      for await (const event of provider.streamTurn({
        runtimeSession: draft.runtimeSession,
        profile,
        message: userText,
        modelId: draft.modelId,
        thinkingEffort: draft.thinkingEffort,
        systemPrompt,
        history,
      })) {
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
          providerSessionId: draft.runtimeSession.providerSessionId,
          error: serializedError.payload,
        })
      }
    }

    await dbTask
    await this.flushNow(draft, finalStatus, finalError)
    this.drafts.delete(draft.chatSessionId)

    // Index completed message in FTS
    if (finalStatus === 'complete') {
      try {
        const session = getDb().select().from(sessions).where(eq(sessions.id, draft.chatSessionId)).get()
        if (session) {
          ThreadSearchEngine.getInstance().indexMessage(
            draft.chatSessionId,
            session.title,
            draft.messageId,
            JSON.stringify(draft.message),
          )
        }
      }
      catch (err) {
        console.error('[ChatEngine] FTS indexing failed:', err)
      }
    }

    // Persist token usage if the provider reported it
    if (finalStatus === 'complete' && provider?.lastUsage) {
      try {
        const session = getDb().select().from(sessions).where(eq(sessions.id, draft.chatSessionId)).get()
        getDb().insert(usageLogs).values({
          id: randomUUID(),
          sessionId: draft.chatSessionId,
          messageId: draft.messageId,
          agentProfileId: draft.agentId,
          modelId: draft.modelId ?? session?.modelId ?? null,
          promptTokens: provider.lastUsage.promptTokens,
          completionTokens: provider.lastUsage.completionTokens,
          totalTokens: provider.lastUsage.totalTokens,
        }).run()
      }
      catch (err) {
        console.error('[ChatEngine] usage log insert failed:', err)
      }
    }

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
 * Extract optional modelId and configSnapshot from a provider state snapshot.
 * ACP providers store `{ models: SessionModelState, configOptions: [...] }` in the snapshot.
 */
function extractSessionMeta(providerStateSnapshot: string | null): {
  modelId: string | null
  configSnapshot: string | null
} {
  if (!providerStateSnapshot) {
    return { modelId: null, configSnapshot: null }
  }
  try {
    const state = JSON.parse(providerStateSnapshot) as {
      models?: { currentModelId?: string }
      configOptions?: unknown
    }
    return {
      modelId: typeof state?.models?.currentModelId === 'string'
        ? state.models.currentModelId
        : null,
      configSnapshot: state?.configOptions !== undefined
        ? JSON.stringify(state.configOptions)
        : null,
    }
  }
  catch {
    return { modelId: null, configSnapshot: null }
  }
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
