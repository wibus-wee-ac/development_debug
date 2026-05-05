// Input: Provider catalog, SQLite schema, transactional turn projection helpers, and devtool/ACP integrations
// Output: ChatEngine singleton for chat session lifecycle, transactional timeline persistence, and renderer broadcasts
// Position: Chat feature orchestrator consumed by IPC adapters and issue-agent workflows

import { randomUUID } from 'node:crypto'

import { observePush } from '@cradle/ipc'
import type { UIMessage, UIMessageChunk } from 'ai'
import { eq, inArray } from 'drizzle-orm'
import type { WebContents } from 'electron'

import { getProviderCatalog } from '../agent-runtime/catalog-instance'
import type { ChatRuntimeProvider, ProviderKind, RuntimeSession as ProviderSession } from '../agent-runtime/runtime-provider-types'
import { getBackendControlPlaneService } from '../backend-control-plane/backend-control-plane'
import type { BackendTimelineEvent, TimelineInputEvent } from '../backend-control-plane/timeline-events'
import { getDb } from '../../db'
import type { Message, Session } from '../../db/schema'
import { agentProfiles as agentProfilesTable, messages, sessions, usageLogs, workspaces } from '../../db/schema'
import { AcpConnectionManager } from '../../platform/acp/acp-connection'
import type { ChatSessionActivityPayload, ChatTimelineEventPayload } from '../../../shared/chat-events'
import { getAgentContextDevtoolStore } from '../../devtools/agent-context-devtool-store'
import { resolveChatTurnContext } from './chat-turn-context'
import { persistProjectedTimelineEvent } from './chat-turn-persistence'
import {
  applyTimelineEventToChatTurn,
  createChatTurnProjector,
  type ChatTurnProjector,
} from './chat-turn-projector'
import { ThreadSearchEngine } from './thread-search'

// ── Types ─────────────────────────────────────────────────────────────────────

type MessageStatus = 'streaming' | 'complete' | 'aborted' | 'failed'

interface Draft {
  chatSessionId: string
  runId: string | null
  messageId: string
  userMessageId: string
  agentId: string
  runtimeSession: ProviderSession
  message: UIMessage
  projector: ChatTurnProjector
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

export type ChatTurnStatus = 'complete' | 'aborted' | 'failed'

export interface ChatTurnFinishedEvent {
  chatSessionId: string
  messageId: string
  status: ChatTurnStatus
  errorText: string | null
  agentProfileId: string
  finishedAt: number
}

// ── Engine ────────────────────────────────────────────────────────────────────

export class ChatEngine {
  private static instance: ChatEngine
  private readonly drafts = new Map<string, Draft>()
  private readonly subscribers = new Set<WebContents>()
  private readonly sessionWatchers = new Map<string, Map<WebContents, number>>()
  private readonly turnFinishedSubscribers = new Set<(event: ChatTurnFinishedEvent) => void>()
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
        const bindings = getBackendControlPlaneService().listBindingsByBackendSessionId(acpSessionId)
        for (const binding of bindings) {
          const row = db.select().from(sessions).where(eq(sessions.id, binding.chatSessionId)).get()
          if (!row) {
            continue
          }
          db.update(sessions)
            .set({ title, updatedAt: nowUnix() })
            .where(eq(sessions.id, row.id))
            .run()
          this.broadcastGlobal('chat:session-title', { chatSessionId: row.id, title })
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
    this.drafts.clear()
    this.subscribers.clear()
    this.sessionWatchers.clear()
    this.initialized = false
  }

  /** Attach a renderer WebContents to receive chat:* broadcasts. */
  subscribe(wc: WebContents): () => void {
    this.subscribers.add(wc)
    if ('once' in wc) {
      wc.once('destroyed', () => this.detachWebContents(wc))
    }
    return () => {
      this.detachWebContents(wc)
    }
  }

  watchSession(wc: WebContents, chatSessionId: string): void {
    const counts = this.sessionWatchers.get(chatSessionId) ?? new Map<WebContents, number>()
    counts.set(wc, (counts.get(wc) ?? 0) + 1)
    this.sessionWatchers.set(chatSessionId, counts)
  }

  unwatchSession(wc: WebContents, chatSessionId: string): void {
    const counts = this.sessionWatchers.get(chatSessionId)
    if (!counts) {
      return
    }

    const current = counts.get(wc) ?? 0
    if (current <= 1) {
      counts.delete(wc)
    }
    else {
      counts.set(wc, current - 1)
    }

    if (counts.size === 0) {
      this.sessionWatchers.delete(chatSessionId)
    }
  }

  /**
   * Subscribe to turn lifecycle completion events.
   * Used by higher-level orchestrators that need deterministic completion.
   */
  onTurnFinished(listener: (event: ChatTurnFinishedEvent) => void): () => void {
    this.turnFinishedSubscribers.add(listener)
    return () => {
      this.turnFinishedSubscribers.delete(listener)
    }
  }

  private detachWebContents(wc: WebContents): void {
    this.subscribers.delete(wc)
    for (const [chatSessionId, counts] of this.sessionWatchers.entries()) {
      counts.delete(wc)
      if (counts.size === 0) {
        this.sessionWatchers.delete(chatSessionId)
      }
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
    const { modelId } = extractSessionMeta(runtimeSession.providerStateSnapshot)
    const requestedModelId = optsModelId ?? modelId

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
      },
    })

    const controlPlane = getBackendControlPlaneService()
    controlPlane.attachBinding({
      chatSessionId,
      agentProfileId: profile.id,
      providerKind: runtimeSession.providerKind,
      backendSessionId: runtimeSession.providerSessionId,
      backendStateSnapshot: runtimeSession.providerStateSnapshot,
      requestedModelId,
    })
    draft.runId = controlPlane.startRun({
      chatSessionId,
      messageId: draft.messageId,
      origin: 'user',
    }).id
    this.recordSessionCapabilitySnapshot(profile.id, profile.providerKind, runtimeSession.providerStateSnapshot)

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
    const provider = this.getChatProvider(profile.providerKind)
    const controlPlane = getBackendControlPlaneService()
    const binding = controlPlane.getBinding(chatSessionId)

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
      providerKind: binding?.providerKind ?? profile.providerKind,
      providerSessionId: binding?.backendSessionId ?? null,
      providerStateSnapshot: binding?.backendStateSnapshot ?? null,
    }

    const runtimeSession = await provider.resumeChatSession({
      runtimeSession: storedSession,
      profile,
      workspacePath: cwd,
    })
    const resumedMeta = extractSessionMeta(runtimeSession.providerStateSnapshot)
    controlPlane.attachBinding({
      chatSessionId,
      agentProfileId: profile.id,
      providerKind: runtimeSession.providerKind,
      backendSessionId: runtimeSession.providerSessionId,
      backendStateSnapshot: runtimeSession.providerStateSnapshot,
      requestedModelId: binding?.requestedModelId ?? resumedMeta.modelId,
    })
    this.recordSessionCapabilitySnapshot(profile.id, profile.providerKind, runtimeSession.providerStateSnapshot)

    // prepareTurn re-checks the draft map atomically (sync), so any race
    // between this line and the fail-fast guard above is still rejected.
    const draft = this.prepareTurn({
      chatSessionId,
      agentId: session.agentProfileId,
      runtimeSession,
      userText: text,
      modelId: binding?.requestedModelId ?? resumedMeta.modelId ?? undefined,
    })
    draft.runId = controlPlane.startRun({
      chatSessionId,
      messageId: draft.messageId,
      origin: 'user',
    }).id

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
    const controlPlane = getBackendControlPlaneService()
    const binding = controlPlane.getBinding(chatSessionId)

    // If there's already a stored provider session ID, try to verify/resume it
    if (binding?.backendSessionId) {
      return { liveAcpSessionId: binding.backendSessionId, continuity: 'active' }
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
    const provider = this.getChatProvider(profile.providerKind)
    const storedSession: ProviderSession = {
      id: session.id,
      chatSessionId: session.id,
      agentProfileId: session.agentProfileId,
      providerKind: binding?.providerKind ?? profile.providerKind,
      providerSessionId: null,
      providerStateSnapshot: binding?.backendStateSnapshot ?? null,
    }
    const resumed = await provider.resumeChatSession({ runtimeSession: storedSession, profile, workspacePath: cwd })
    const resumedMeta = extractSessionMeta(resumed.providerStateSnapshot)
    const updatedBinding = controlPlane.attachBinding({
      chatSessionId,
      agentProfileId: profile.id,
      providerKind: resumed.providerKind,
      backendSessionId: resumed.providerSessionId,
      backendStateSnapshot: resumed.providerStateSnapshot,
      requestedModelId: binding?.requestedModelId ?? resumedMeta.modelId,
    })
    this.recordSessionCapabilitySnapshot(profile.id, profile.providerKind, resumed.providerStateSnapshot)
    const liveSessionId = updatedBinding.backendSessionId ?? chatSessionId

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
      runId: null,
      messageId: assistantMsgId,
      userMessageId: userMsgId,
      agentId,
      runtimeSession,
      message: assistantMessage,
      projector: createChatTurnProjector(assistantMessage),
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
   *  - Appends Cradle-owned timeline facts inside the same transaction that updates the assistant snapshot
   *  - Broadcasts persisted facts only to windows explicitly watching the session
   *  - Emits terminal activity summaries globally for unread indicators
   */
  private async runStream(draft: Draft, userText: string): Promise<void> {
    let finalStatus: MessageStatus = 'complete'
    let finalError: string | null = null
    let provider: ChatRuntimeProvider | null = null

    const emitTimelineEvent = async (
      event: TimelineInputEvent,
      options: {
        messageStatus?: MessageStatus
        errorText?: string | null
        runCompletion?: {
          status: ChatTurnStatus
          stopReason: string | null
          errorText: string | null
        }
      } = {},
    ): Promise<BackendTimelineEvent> => {
      if (!draft.runId) {
        throw new Error(`Missing backend run for chat session: ${draft.chatSessionId}`)
      }

      const chunks = applyTimelineEventToChatTurn(draft.projector, event)
      draft.message = draft.projector.message

      const stored = persistProjectedTimelineEvent({
        chatSessionId: draft.chatSessionId,
        messageId: draft.messageId,
        runId: draft.runId,
        event,
        messageJson: JSON.stringify(draft.message),
        messageStatus: options.messageStatus ?? 'streaming',
        errorText: options.errorText ?? null,
        runCompletion: options.runCompletion,
      })
      this.broadcastTimelineEvent(draft, stored, chunks)

      if (stored.type === 'run.completed' || stored.type === 'run.aborted' || stored.type === 'run.failed') {
        this.broadcastSessionActivity({
          chatSessionId: draft.chatSessionId,
          messageId: draft.messageId,
          status: options.runCompletion?.status ?? 'failed',
          errorText: options.errorText ?? null,
        })
      }

      return stored
    }

    await emitTimelineEvent({
      type: 'run.started',
      source: {
        backend: draft.runtimeSession.providerKind,
        eventType: 'chat.turn.started',
        metadata: {
          messageId: draft.messageId,
          userMessageId: draft.userMessageId,
        },
      },
    })

    try {
      const profile = this.loadProfile(draft.agentId)
      provider = this.getChatProvider(profile.providerKind)

      const turnContext = resolveChatTurnContext({
        chatSessionId: draft.chatSessionId,
        draftMessageId: draft.messageId,
        draftUserMessageId: draft.userMessageId,
        fallbackAgentId: draft.agentId,
        providerKind: profile.providerKind,
      })

      // Record agent context for devtool observability (all providers)
      getAgentContextDevtoolStore().record({
        id: randomUUID(),
        timestamp: Date.now(),
        chatSessionId: draft.chatSessionId,
        agentId: draft.agentId ?? null,
        agentName: turnContext.agentName,
        systemPrompt: turnContext.systemPrompt ?? null,
        skillsCatalog: [],
        historyLength: turnContext.history?.length ?? 0,
        providerKind: profile.providerKind,
      })

      for await (const event of provider.streamTurn({
        runtimeSession: draft.runtimeSession,
        profile,
        message: userText,
        modelId: draft.modelId,
        thinkingEffort: draft.thinkingEffort,
        systemPrompt: turnContext.systemPrompt,
        history: turnContext.history,
      })) {
        await emitTimelineEvent(event)
      }
    }
    catch (err) {
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

    await emitTimelineEvent(
      finalStatus === 'complete'
        ? {
            type: 'run.completed',
            source: {
              backend: draft.runtimeSession.providerKind,
              eventType: 'chat.turn.completed',
            },
          }
        : finalStatus === 'aborted'
          ? {
              type: 'run.aborted',
              source: {
                backend: draft.runtimeSession.providerKind,
                eventType: 'chat.turn.aborted',
              },
            }
          : {
              type: 'run.failed',
              error: finalError ?? 'chat failed',
              source: {
                backend: draft.runtimeSession.providerKind,
                eventType: 'chat.turn.failed',
              },
            },
      {
        messageStatus: finalStatus,
        errorText: finalError,
        runCompletion: {
          status: finalStatus,
          stopReason: finalStatus === 'complete'
            ? 'response.completed'
            : draft.cancelled
              ? 'response.cancelled'
              : 'response.failed',
          errorText: finalError,
        },
      },
    )

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
        const binding = getBackendControlPlaneService().getBinding(draft.chatSessionId)
        getDb().insert(usageLogs).values({
          id: randomUUID(),
          sessionId: draft.chatSessionId,
          messageId: draft.messageId,
          agentProfileId: draft.agentId,
          modelId: draft.modelId ?? binding?.requestedModelId ?? null,
          promptTokens: provider.lastUsage.promptTokens,
          completionTokens: provider.lastUsage.completionTokens,
          totalTokens: provider.lastUsage.totalTokens,
        }).run()
      }
      catch (err) {
        console.error('[ChatEngine] usage log insert failed:', err)
      }
    }

    const finishedEvent: ChatTurnFinishedEvent = {
      chatSessionId: draft.chatSessionId,
      messageId: draft.messageId,
      status: finalStatus,
      errorText: finalError,
      agentProfileId: draft.agentId,
      finishedAt: Date.now(),
    }
    for (const subscriber of [...this.turnFinishedSubscribers]) {
      try {
        subscriber(finishedEvent)
      }
      catch (error) {
        console.error('[ChatEngine] turn-finished subscriber failed:', error)
      }
    }
  }

  private broadcastTimelineEvent(
    draft: Draft,
    event: BackendTimelineEvent,
    chunks: UIMessageChunk[],
  ): void {
    const payload: ChatTimelineEventPayload = {
      chatSessionId: draft.chatSessionId,
      messageId: draft.messageId,
      event,
      chunks,
    }
    this.broadcastSession('chat:timeline-event', draft.chatSessionId, payload)
  }

  private broadcastSessionActivity(event: ChatSessionActivityPayload): void {
    this.broadcastGlobal('chat:session-activity', event)
  }

  private broadcastSession<T extends { chatSessionId: string }>(
    channel: string,
    chatSessionId: string,
    payload: T,
  ): void {
    observePush(channel, payload, { flowId: payload.chatSessionId })

    const watchers = this.sessionWatchers.get(chatSessionId)
    if (!watchers) {
      return
    }

    for (const wc of [...watchers.keys()]) {
      if (wc.isDestroyed()) {
        this.detachWebContents(wc)
        continue
      }
      try {
        wc.send(channel, payload)
      }
      catch {
        this.detachWebContents(wc)
      }
    }
  }

  private broadcastGlobal<T extends { chatSessionId: string }>(
    channel: string,
    payload: T,
  ): void {
    observePush(channel, payload, { flowId: payload.chatSessionId })

    for (const wc of [...this.subscribers]) {
      if (wc.isDestroyed()) {
        this.detachWebContents(wc)
        continue
      }
      try {
        wc.send(channel, payload)
      }
      catch {
        this.detachWebContents(wc)
      }
    }
  }

  private recordSessionCapabilitySnapshot(
    agentProfileId: string,
    providerKind: ProviderKind,
    providerStateSnapshot: string | null,
  ): void {
    if (!providerStateSnapshot) {
      return
    }
    getBackendControlPlaneService().recordCapabilitySnapshot({
      agentProfileId,
      providerKind,
      source: 'session_start',
      capabilitiesJson: providerStateSnapshot,
    })
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * Extract optional modelId from a provider state snapshot.
 * ACP providers store `{ models: SessionModelState, configOptions: [...] }` in the snapshot.
 */
function extractSessionMeta(providerStateSnapshot: string | null): {
  modelId: string | null
} {
  if (!providerStateSnapshot) {
    return { modelId: null }
  }
  try {
    const state = JSON.parse(providerStateSnapshot) as {
      models?: { currentModelId?: string }
    }
    return {
      modelId: typeof state?.models?.currentModelId === 'string'
        ? state.models.currentModelId
        : null,
    }
  }
  catch {
    return { modelId: null }
  }
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
