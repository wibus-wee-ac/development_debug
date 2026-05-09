// Input: DbAccessor, chat tables, and timeline codec helpers
// Output: chat-runtime persistence for draft messages, runs, timeline facts, and usage logs
// Position: apps/server/src/modules/chat-runtime/chat-runtime.store.ts

import { randomUUID } from 'node:crypto'

import type { AgentProfile, BackendRun, BackendSessionBinding, Message, Session } from '@cradle/db'
import {
  backendRuns,
  backendSessionBindings,
  backendTimelineEvents,
  messages,
  sessions,
  usageLogs,
  workspaces,
} from '@cradle/db'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { inject, injectable } from 'tsyringe'

import { DbAccessor } from '../../database/db-accessor'
import { ProfilesStore } from '../profiles/profiles.store'
import type { ProviderKind } from '../providers/types'
import type { RuntimeSession, TimelineInputEvent, TokenUsage } from './runtime-provider-types'
import { decodeTimelineInputEvent, encodeTimelineInputEvent, TIMELINE_SCHEMA_VERSION } from './timeline-events'
import type { StoredTimelineEvent } from './timeline-events'

export type ChatMessageStatus = 'streaming' | 'complete' | 'aborted' | 'failed'

export interface ChatTimelineGroup {
  messageId: string
  role: 'user' | 'assistant'
  userText?: string
  status: ChatMessageStatus
  errorText?: string
  events: StoredTimelineEvent[]
}

export interface SessionRunContext {
  session: Session
  workspacePath: string
  profile: AgentProfile
}

@injectable()
export class ChatRuntimeStore {
  constructor(
    @inject(DbAccessor) private readonly dbAccessor: DbAccessor,
    @inject(ProfilesStore) private readonly profilesStore: ProfilesStore,
  ) {}

  getSessionRunContext(sessionId: string): SessionRunContext | null {
    const db = this.dbAccessor.get()
    const session = db.select().from(sessions).where(eq(sessions.id, sessionId)).get()
    if (!session) {
      return null
    }
    const workspace = db.select().from(workspaces).where(eq(workspaces.id, session.workspaceId)).get()
    const profile = this.profilesStore.getProfile(session.agentProfileId)
    if (!workspace || !profile) {
      return null
    }
    return {
      session,
      workspacePath: workspace.path,
      profile,
    }
  }

  getBinding(sessionId: string): BackendSessionBinding | undefined {
    return this.dbAccessor.get().select().from(backendSessionBindings).where(eq(backendSessionBindings.chatSessionId, sessionId)).get()
  }

  listChatSessionIdsByBackendSessionId(backendSessionId: string): string[] {
    return this.dbAccessor.get()
      .select({ chatSessionId: backendSessionBindings.chatSessionId })
      .from(backendSessionBindings)
      .where(eq(backendSessionBindings.backendSessionId, backendSessionId))
      .all()
      .map(row => row.chatSessionId)
  }

  attachBinding(input: {
    sessionId: string
    agentProfileId: string
    providerKind: ProviderKind
    runtimeSession: RuntimeSession
    requestedModelId: string | null
  }): BackendSessionBinding {
    const db = this.dbAccessor.get()
    const now = nowUnix()
    const existing = this.getBinding(input.sessionId)

    if (existing) {
      db.update(backendSessionBindings)
        .set({
          agentProfileId: input.agentProfileId,
          providerKind: input.providerKind,
          backendSessionId: input.runtimeSession.providerSessionId,
          backendStateSnapshot: input.runtimeSession.providerStateSnapshot,
          requestedModelId: input.requestedModelId,
          updatedAt: now,
        })
        .where(eq(backendSessionBindings.id, existing.id))
        .run()
      return db.select().from(backendSessionBindings).where(eq(backendSessionBindings.id, existing.id)).get()!
    }

    const binding = db.insert(backendSessionBindings).values({
        id: randomUUID(),
        chatSessionId: input.sessionId,
        agentProfileId: input.agentProfileId,
        providerKind: input.providerKind,
        backendSessionId: input.runtimeSession.providerSessionId,
        backendStateSnapshot: input.runtimeSession.providerStateSnapshot,
        requestedModelId: input.requestedModelId,
        createdAt: now,
        updatedAt: now,
      }).returning()

    return binding.get()
  }

  createDraftTurn(input: { sessionId: string, userText: string }): { userMessageId: string, assistantMessageId: string } {
    const userMessageId = randomUUID()
    const assistantMessageId = randomUUID()
    const now = nowUnix()

    this.dbAccessor.get().transaction((tx) => {
      tx.insert(messages).values({
        id: userMessageId,
        sessionId: input.sessionId,
        role: 'user',
        status: 'complete',
        content: input.userText,
        createdAt: now,
        updatedAt: now,
      }).run()
      tx.insert(messages).values({
        id: assistantMessageId,
        sessionId: input.sessionId,
        role: 'assistant',
        status: 'streaming',
        content: '',
        createdAt: now,
        updatedAt: now,
      }).run()
      tx.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, input.sessionId)).run()
    })

    return { userMessageId, assistantMessageId }
  }

  startRun(input: { sessionId: string, messageId: string, origin: 'user' | 'issue-agent' | 'system' }): BackendRun {
    const binding = this.getBinding(input.sessionId)
    if (!binding) {
      throw new Error(`Backend binding not found for chat session: ${input.sessionId}`)
    }
    const run = this.dbAccessor.get().insert(backendRuns).values({
        id: randomUUID(),
        bindingId: binding.id,
        chatSessionId: input.sessionId,
        messageId: input.messageId,
        origin: input.origin,
        status: 'streaming',
        stopReason: null,
        errorText: null,
        startedAt: nowUnix(),
        finishedAt: null,
      }).returning()

    return run.get()
  }

  getRun(runId: string): BackendRun | undefined {
    return this.dbAccessor.get().select().from(backendRuns).where(eq(backendRuns.id, runId)).get()
  }

  persistEvent(input: {
    sessionId: string
    runId: string
    messageId: string
    event: TimelineInputEvent
    messageStatus: ChatMessageStatus
    errorText: string | null
    runCompletion?: {
      status: 'complete' | 'aborted' | 'failed'
      stopReason: string | null
      errorText: string | null
    }
  }): StoredTimelineEvent {
    return this.dbAccessor.get().transaction((tx) => {
      const now = nowUnix()
      const encoded = encodeTimelineInputEvent(input.event)
      const last = tx.select().from(backendTimelineEvents).where(eq(backendTimelineEvents.runId, input.runId)).orderBy(desc(backendTimelineEvents.sequenceNumber)).get()
      const sequenceNumber = (last?.sequenceNumber ?? -1) + 1

      const row = tx.insert(backendTimelineEvents)
        .values({
          id: randomUUID(),
          runId: input.runId,
          chatSessionId: input.sessionId,
          sequenceNumber,
          eventType: encoded.eventType,
          schemaVersion: TIMELINE_SCHEMA_VERSION,
          payloadJson: encoded.payloadJson,
          sourceJson: encoded.sourceJson,
          createdAt: now,
        })
        .returning()
        .get()

      const currentMessage = tx.select().from(messages).where(eq(messages.id, input.messageId)).get()
      const nextContent = input.event.type === 'assistant.text.delta'
        ? `${currentMessage?.content ?? ''}${input.event.delta}`
        : currentMessage?.content ?? ''

      tx.update(messages)
        .set({
          content: nextContent,
          status: input.messageStatus,
          errorText: input.errorText,
          updatedAt: now,
        })
        .where(and(eq(messages.id, input.messageId), eq(messages.sessionId, input.sessionId)))
        .run()

      tx.update(sessions)
        .set({ updatedAt: now })
        .where(eq(sessions.id, input.sessionId))
        .run()

      if (input.runCompletion) {
        tx.update(backendRuns)
          .set({
            status: input.runCompletion.status,
            stopReason: input.runCompletion.stopReason,
            errorText: input.runCompletion.errorText,
            finishedAt: now,
          })
          .where(eq(backendRuns.id, input.runId))
          .run()
      }

      return {
        id: row.id,
        runId: row.runId,
        chatSessionId: row.chatSessionId,
        sequenceNumber: row.sequenceNumber,
        schemaVersion: row.schemaVersion as typeof TIMELINE_SCHEMA_VERSION,
        createdAt: row.createdAt,
        ...decodeTimelineInputEvent({
          eventType: row.eventType,
          payloadJson: row.payloadJson,
          sourceJson: row.sourceJson,
        }),
      }
    })
  }

  insertUsage(input: { sessionId: string, messageId: string, agentProfileId: string, modelId: string | null, usage: TokenUsage }): void {
    this.dbAccessor.get().insert(usageLogs).values({
      id: randomUUID(),
      sessionId: input.sessionId,
      messageId: input.messageId,
      agentProfileId: input.agentProfileId,
      modelId: input.modelId,
      promptTokens: input.usage.promptTokens,
      completionTokens: input.usage.completionTokens,
      totalTokens: input.usage.totalTokens,
      createdAt: nowUnix(),
    }).run()
  }

  getTimeline(sessionId: string): ChatTimelineGroup[] {
    const db = this.dbAccessor.get()
    const rows = db.select().from(messages).where(eq(messages.sessionId, sessionId)).orderBy(messages.createdAt).all()
    const assistantIds = rows.filter(row => row.role === 'assistant').map(row => row.id)
    const latestRunByMessageId = new Map<string, BackendRun>()

    if (assistantIds.length > 0) {
      const runs = db.select().from(backendRuns).where(inArray(backendRuns.messageId, assistantIds)).orderBy(desc(backendRuns.startedAt)).all()
      for (const run of runs) {
        if (!run.messageId || latestRunByMessageId.has(run.messageId)) {
          continue
        }
        latestRunByMessageId.set(run.messageId, run)
      }
    }

    const runIds = [...new Set(Array.from(latestRunByMessageId.values(), run => run.id))]
    const eventsByRunId = new Map<string, StoredTimelineEvent[]>()

    if (runIds.length > 0) {
      const eventRows = db.select().from(backendTimelineEvents).where(inArray(backendTimelineEvents.runId, runIds)).orderBy(backendTimelineEvents.runId, backendTimelineEvents.sequenceNumber).all()
      for (const row of eventRows) {
        const bucket = eventsByRunId.get(row.runId) ?? []
        bucket.push({
          id: row.id,
          runId: row.runId,
          chatSessionId: row.chatSessionId,
          sequenceNumber: row.sequenceNumber,
          schemaVersion: row.schemaVersion as typeof TIMELINE_SCHEMA_VERSION,
          createdAt: row.createdAt,
          ...decodeTimelineInputEvent({
            eventType: row.eventType,
            payloadJson: row.payloadJson,
            sourceJson: row.sourceJson,
          }),
        })
        eventsByRunId.set(row.runId, bucket)
      }
    }

    return rows.map((row) => {
      if (row.role === 'user') {
        return {
          messageId: row.id,
          role: 'user' as const,
          userText: row.content,
          status: row.status as ChatMessageStatus,
          errorText: row.errorText ?? undefined,
          events: [],
        }
      }
      const runId = latestRunByMessageId.get(row.id)?.id
      return {
        messageId: row.id,
        role: 'assistant' as const,
        status: row.status as ChatMessageStatus,
        errorText: row.errorText ?? undefined,
        events: runId ? eventsByRunId.get(runId) ?? [] : [],
      }
    })
  }

  listRunEvents(runId: string): StoredTimelineEvent[] {
    return this.dbAccessor.get().select().from(backendTimelineEvents).where(eq(backendTimelineEvents.runId, runId)).orderBy(backendTimelineEvents.sequenceNumber).all().map(row => ({
      id: row.id,
      runId: row.runId,
      chatSessionId: row.chatSessionId,
      sequenceNumber: row.sequenceNumber,
      schemaVersion: row.schemaVersion as typeof TIMELINE_SCHEMA_VERSION,
      createdAt: row.createdAt,
      ...decodeTimelineInputEvent({
        eventType: row.eventType,
        payloadJson: row.payloadJson,
        sourceJson: row.sourceJson,
      }),
    }))
  }

  getMessages(sessionId: string): Message[] {
    return this.dbAccessor.get().select().from(messages).where(eq(messages.sessionId, sessionId)).orderBy(messages.createdAt).all()
  }
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}
