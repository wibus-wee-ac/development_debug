// Input: Provider catalog, SQLite schema, transactional turn projection helpers, and devtool/ACP integrations
// Output: ChatEngine singleton for chat session lifecycle, transactional timeline persistence, and renderer broadcasts
// Position: Chat feature orchestrator consumed by IPC adapters and issue-agent workflows

import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import type { WebContents } from 'electron'

import { getDb } from '../db'
import type { Message, Session } from '../db/schema'
import { agentProfiles as agentProfilesTable, backendTimelineEvents, messages, sessions, workspaces } from '../db/schema'
import { getAgentContextDevtoolStore } from '../devtools/agent-context-devtool-store'
import type { DomainEventBus } from '../events/domain-event-bus'
import { acpConnectionManager } from '../acp/acp-connection'
import type { SignalBroadcaster } from '../signal/broadcaster'
import { getProviderCatalog } from '../agent-runtime/catalog-instance'
import type { ChatRuntimeProvider, ProviderKind, RuntimeSession as ProviderSession } from '../agent-runtime/runtime-provider-types'
import { getBackendControlPlaneService } from '../backend-control-plane/backend-control-plane'
import type { BackendTimelineEvent, TimelineInputEvent } from '../backend-control-plane/timeline-events'
import { resolveChatTurnContext } from './chat-turn-context'
import { coordinateTurn } from './turn-coordinator'
import type { TurnRepository } from './turn-repository'
import { createTurnRepository } from './turn-repository'
import type { TimelineChunkProjector } from './timeline-chunk-projector'
import { createTimelineChunkProjector } from './timeline-chunk-projector'

// ── Types ─────────────────────────────────────────────────────────────────────

type MessageStatus = 'streaming' | 'complete' | 'aborted' | 'failed'

interface Draft {
  chatSessionId: string
  runId: string | null
  messageId: string
  userMessageId: string
  agentId: string
  runtimeSession: ProviderSession
  turn: TimelineChunkProjector
  /** AbortController for stream cancellation — replaces boolean `cancelled` flag. */
  abortController: AbortController
  /** Optional model override for this draft's turns. */
  modelId?: string
  /** Provider-specific options (e.g., thinkingEffort). Opaque to the engine. */
  providerOptions?: Record<string, unknown>
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
  providerOptions?: Record<string, unknown>
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

interface TurnOutputDiagnostics {
  emittedEventCount: number
  assistantBoundaryCount: number
  assistantTextCharCount: number
  reasoningTextCharCount: number
  toolEventCount: number
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
  private readonly drafts = new Map<string, Draft>()
  private readonly subscribers = new Set<WebContents>()
  private readonly sessionWatchers = new Map<string, Map<WebContents, number>>()
  private readonly turnFinishedSubscribers = new Set<(event: ChatTurnFinishedEvent) => void>()
  private titleUnsubscribe: (() => void) | null = null
  private initialized = false
  private _repository: TurnRepository | null = null
  private eventBus: DomainEventBus | null = null
  private signalBroadcaster: SignalBroadcaster | null = null

  private getRepository(): TurnRepository {
    if (!this._repository) {
      this._repository = createTurnRepository({ db: getDb() })
    }
    return this._repository
  }

  /** Bind a domain event bus for publishing streaming lifecycle events. */
  bindEventBus(bus: DomainEventBus): void {
    this.eventBus = bus
  }

  /** Bind the unified signal broadcaster for renderer push events. */
  bindSignalBroadcaster(broadcaster: SignalBroadcaster): void {
    this.signalBroadcaster = broadcaster
  }

  /** One-time setup: clean up dangling streaming messages, wire transport hooks. */
  initialize(): void {
    if (this.initialized) {
      return
    }
    this.initialized = true

    // Create repository and run crash recovery
    this.getRepository().recoverStrandedRuns()

    // Forward agent title updates → chat:session-title with chatSessionId mapping.
    this.titleUnsubscribe = acpConnectionManager.onSessionTitle(
      (acpSessionId, title) => {
        const bindings = getBackendControlPlaneService().listBindingsByBackendSessionId(acpSessionId)
        for (const binding of bindings) {
          const row = getDb().select().from(sessions).where(eq(sessions.id, binding.chatSessionId)).get()
          if (!row) {
            continue
          }
          getDb()
            .update(sessions)
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
    this._repository = null
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

  /** Expose session watchers for broadcast subscriber wiring. */
  getSessionWatchers(): Map<string, Map<WebContents, number>> {
    return this.sessionWatchers
  }

  /** Expose global subscribers for broadcast subscriber wiring. */
  getGlobalSubscribers(): Set<WebContents> {
    return this.subscribers
  }

  /** Expose detach logic for broadcast subscriber cleanup. */
  detachRenderer(wc: WebContents): void {
    this.detachWebContents(wc)
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

    const providerOptions: Record<string, unknown> | undefined = thinkingEffort
      ? { thinkingEffort }
      : undefined

    const draft = this.prepareTurn({
      chatSessionId,
      agentId,
      agentIdentityId: opts.agentIdentityId,
      runtimeSession,
      userText: text,
      modelId: optsModelId,
      providerOptions,
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
    draft.abortController.abort()
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
        // Active draft — return as streaming (content reconstruction is done via timeline events)
        return rowToChatMessage(row)
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

  /**
   * Returns timeline event groups for a session, suitable for renderer-side projection.
   * Each group represents one message (user or assistant) with its raw events.
   */
  getSessionTimeline(chatSessionId: string): Array<{
    messageId: string
    role: 'user' | 'assistant'
    events: Array<Record<string, unknown>>
    userText?: string
    status: string
    errorText?: string
  }> {
    const db = getDb()
    const rows = db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, chatSessionId))
      .orderBy(messages.createdAt)
      .all()

    return rows.map((row) => {
      if (row.role === 'user') {
        // User messages: content is plain text
        return { messageId: row.id, role: 'user' as const, events: [], userText: row.content, status: row.status }
      }

      // Assistant messages: fetch timeline events
      const events = db
        .select()
        .from(backendTimelineEvents)
        .where(eq(backendTimelineEvents.chatSessionId, chatSessionId))
        .orderBy(backendTimelineEvents.sequenceNumber)
        .all()

      // Decode events from DB format to ProjectableTimelineEvent
      const decoded = events.map(e => ({
        ...JSON.parse(e.payloadJson),
        id: e.id,
        runId: e.runId,
        chatSessionId: e.chatSessionId,
        sequenceNumber: e.sequenceNumber,
      }))

      // For active streams, also include live events from the draft
      const activeDraft = this.drafts.get(chatSessionId)
      if (activeDraft && activeDraft.messageId === row.id) {
        // Use the current in-memory message as source of truth
        return {
          messageId: row.id,
          role: 'assistant' as const,
          events: decoded,
          status: 'streaming',
        }
      }

      return { messageId: row.id, role: 'assistant' as const, events: decoded, status: row.status, errorText: row.errorText ?? undefined }
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
    const { chatSessionId, agentId, agentIdentityId, runtimeSession, userText, newSession, modelId, providerOptions } = args

    // Atomic single-in-flight-turn claim. JS is single-threaded so this is the
    // authoritative check — any caller that loses the race throws here.
    if (this.drafts.has(chatSessionId)) {
      throw new Error(`Chat session ${chatSessionId} already has a turn in progress`)
    }

    const userMsgId = randomUUID()
    const assistantMsgId = randomUUID()

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
          content: userText,
        })
        .run()
      tx.insert(messages)
        .values({
          id: assistantMsgId,
          sessionId: chatSessionId,
          role: 'assistant',
          status: 'streaming',
          content: '',
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
      turn: createTimelineChunkProjector(),
      abortController: new AbortController(),
      modelId,
      providerOptions,
    }
    this.drafts.set(chatSessionId, draft)

    return draft
  }

  /**
   * Drive the transport chunk stream for a prepared draft.
   *
   * Uses TurnCoordinator to drive the provider stream. Side-effects (persist,
   * broadcast, FTS, usage) are still processed inline for now — these will move
   * to event subscribers in a later milestone.
   */
  private async runStream(draft: Draft, userText: string): Promise<void> {
    let finalStatus: MessageStatus = 'complete'
    let finalError: string | null = null
    let provider: ChatRuntimeProvider | null = null
    const turnOutputDiagnostics: TurnOutputDiagnostics = {
      emittedEventCount: 0,
      assistantBoundaryCount: 0,
      assistantTextCharCount: 0,
      reasoningTextCharCount: 0,
      toolEventCount: 0,
    }

    const emitTimelineEvent = (
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
    ): BackendTimelineEvent => {
      if (!draft.runId) {
        throw new Error(`Missing backend run for chat session: ${draft.chatSessionId}`)
      }

      const chunks = draft.turn.apply(event)

      const stored = this.getRepository().persistEvent({
        chatSessionId: draft.chatSessionId,
        messageId: draft.messageId,
        runId: draft.runId,
        event,
        messageStatus: options.messageStatus ?? 'streaming',
        errorText: options.errorText ?? null,
        runCompletion: options.runCompletion,
      })

      const isTerminal = stored.type === 'run.completed' || stored.type === 'run.aborted' || stored.type === 'run.failed'

      // Publish domain event — subscribers handle broadcast + session activity
      if (this.eventBus) {
        void this.eventBus.publish({
          id: randomUUID(),
          type: 'chat.timeline-event-persisted',
          occurredAt: Date.now(),
          payload: {
            chatSessionId: draft.chatSessionId,
            messageId: draft.messageId,
            runId: draft.runId,
            event: stored,
            chunks,
            terminal: isTerminal,
          },
        })
      }

      return stored
    }

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

      // Drive the provider stream via TurnCoordinator
      const turnGen = coordinateTurn({
        provider,
        streamInput: {
          runtimeSession: draft.runtimeSession,
          profile,
          message: userText,
          modelId: draft.modelId,
          providerOptions: draft.providerOptions,
          systemPrompt: turnContext.systemPrompt,
          history: turnContext.history,
        },
        providerKind: profile.providerKind,
        signal: draft.abortController.signal,
      })

      for await (const yield_ of turnGen) {
        const { event } = yield_
        if (yield_.type === 'terminal') {
          // Terminal event — determine final status from the event type
          const terminalEvent = this.resolveTerminalEventWithDiagnostics(
            event,
            draft.runtimeSession.providerKind,
            turnOutputDiagnostics,
          )

          finalStatus = terminalEvent.type === 'run.completed'
            ? 'complete'
            : terminalEvent.type === 'run.aborted'
              ? 'aborted'
              : 'failed'
          finalError = terminalEvent.type === 'run.failed' ? terminalEvent.error : null

          if (finalStatus === 'failed') {
            console.error('[ChatEngine] turn failed', {
              chatSessionId: draft.chatSessionId,
              messageId: draft.messageId,
              agentId: draft.agentId,
              providerSessionId: draft.runtimeSession.providerSessionId,
              error: finalError,
              diagnostics: turnOutputDiagnostics,
            })
          }

          emitTimelineEvent(terminalEvent, {
            messageStatus: finalStatus,
            errorText: finalError,
            runCompletion: {
              status: finalStatus,
              stopReason: finalStatus === 'complete'
                ? 'response.completed'
                : finalStatus === 'aborted'
                  ? 'response.cancelled'
                  : 'response.failed',
              errorText: finalError,
            },
          })
        }
        else {
          accumulateTurnOutputDiagnostics(turnOutputDiagnostics, event)
          emitTimelineEvent(event)
        }
      }
    }
    catch (err) {
      // If something went wrong outside the coordinator (e.g., context resolution, profile load)
      finalStatus = draft.abortController.signal.aborted ? 'aborted' : 'failed'
      const serializedError = serializeChatError(err)
      finalError = serializedError.text

      if (!draft.abortController.signal.aborted) {
        console.error('[ChatEngine] runStream outer failure', {
          chatSessionId: draft.chatSessionId,
          messageId: draft.messageId,
          error: serializedError.payload,
        })
      }

      // Emit terminal event for failures outside the coordinator
      emitTimelineEvent(
        finalStatus === 'aborted'
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
            stopReason: draft.abortController.signal.aborted
              ? 'response.cancelled'
              : 'response.failed',
            errorText: finalError,
          },
        },
      )
    }

    // Flush any buffered delta writes before cleanup
    this.getRepository().flush()

    this.drafts.delete(draft.chatSessionId)

    const finishedEvent: ChatTurnFinishedEvent = {
      chatSessionId: draft.chatSessionId,
      messageId: draft.messageId,
      status: finalStatus,
      errorText: finalError,
      agentProfileId: draft.agentId,
      finishedAt: Date.now(),
    }

    // Publish chat.message-completed domain event — subscribers handle FTS + usage
    if (this.eventBus) {
      const binding = getBackendControlPlaneService().getBinding(draft.chatSessionId)

      // Extract plain text from timeline events for FTS indexing
      const db = getDb()
      const timelineRows = db
        .select()
        .from(backendTimelineEvents)
        .where(eq(backendTimelineEvents.runId, draft.runId!))
        .orderBy(backendTimelineEvents.sequenceNumber)
        .all()
      const assistantText = timelineRows
        .map(r => JSON.parse(r.payloadJson))
        .filter((e: { type: string }) => e.type === 'assistant.text.delta')
        .map((e: { delta?: string }) => e.delta ?? '')
        .join('')

      void this.eventBus.publish({
        id: randomUUID(),
        type: 'chat.message-completed',
        occurredAt: Date.now(),
        payload: {
          chatSessionId: draft.chatSessionId,
          messageId: draft.messageId,
          status: finalStatus,
          errorText: finalError,
          assistantText,
          agentProfileId: draft.agentId,
          modelId: draft.modelId ?? binding?.requestedModelId ?? null,
          usage: provider?.lastUsage ?? null,
        },
      })
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

  private resolveTerminalEventWithDiagnostics(
    event: Extract<TimelineInputEvent, { type: 'run.completed' | 'run.aborted' | 'run.failed' }>,
    providerKind: ProviderKind,
    diagnostics: TurnOutputDiagnostics,
  ): Extract<TimelineInputEvent, { type: 'run.completed' | 'run.aborted' | 'run.failed' }> {
    if (event.type !== 'run.completed') {
      return event
    }

    const validation = validateTurnOutput(diagnostics)
    if (validation.ok) {
      return event
    }

    return buildEmptyOutputFailureEvent(event, providerKind, diagnostics)
  }

  private broadcastGlobal<T extends { chatSessionId: string }>(
    _channel: string,
    payload: T,
  ): void {
    if (this.signalBroadcaster) {
      this.signalBroadcaster.broadcastGlobal('chat:session-title', payload as unknown as import('../../shared/chat-events').ChatSessionTitlePayload)
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

interface TurnOutputValidationResult {
  ok: boolean
  errorText: string | null
}

function accumulateTurnOutputDiagnostics(
  diagnostics: TurnOutputDiagnostics,
  event: TimelineInputEvent,
): void {
  diagnostics.emittedEventCount += 1

  switch (event.type) {
    case 'assistant.message.started':
    case 'assistant.message.completed':
      diagnostics.assistantBoundaryCount += 1
      break
    case 'assistant.text.delta':
      diagnostics.assistantTextCharCount += event.delta.length
      break
    case 'reasoning.delta':
      diagnostics.reasoningTextCharCount += event.delta.length
      break
    case 'command.started':
    case 'command.output.delta':
    case 'command.completed':
    case 'tool_call.started':
    case 'tool_call.output.delta':
    case 'tool_call.completed':
    case 'file_change.started':
    case 'file_change.completed':
    case 'approval.requested':
    case 'approval.resolved':
      diagnostics.toolEventCount += 1
      break
    default:
      break
  }
}

function validateTurnOutput(diagnostics: TurnOutputDiagnostics): TurnOutputValidationResult {
  const hasTextOutput = diagnostics.assistantTextCharCount > 0 || diagnostics.reasoningTextCharCount > 0
  const hasToolOutput = diagnostics.toolEventCount > 0

  if (hasTextOutput || hasToolOutput) {
    return { ok: true, errorText: null }
  }

  return {
    ok: false,
    errorText: `Provider finished without any assistant output events (events=${diagnostics.emittedEventCount}, assistant_boundaries=${diagnostics.assistantBoundaryCount}, assistant_text_chars=${diagnostics.assistantTextCharCount}, reasoning_chars=${diagnostics.reasoningTextCharCount}, tool_events=${diagnostics.toolEventCount})`,
  }
}

function buildEmptyOutputFailureEvent(
  originalEvent: Extract<TimelineInputEvent, { type: 'run.completed' }>,
  providerKind: ProviderKind,
  diagnostics: TurnOutputDiagnostics,
): Extract<TimelineInputEvent, { type: 'run.failed' }> {
  const validation = validateTurnOutput(diagnostics)
  const errorText = validation.errorText ?? 'Provider finished without assistant output events'

  return {
    type: 'run.failed',
    error: errorText,
    source: {
      backend: providerKind,
      eventType: 'chat.turn.failed.empty-output',
      metadata: {
        terminalEventType: originalEvent.type,
        diagnostics,
      },
    },
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

export const chatEngine = new ChatEngine()
