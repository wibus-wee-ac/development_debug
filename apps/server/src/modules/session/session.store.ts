// Input: DbAccessor + session tables
// Output: session CRUD store
// Position: apps/server/src/modules/session/session.store.ts

import { randomUUID } from 'node:crypto'

import type { Message, Session } from '@cradle/db'
import { backendRuns, backendTimelineEvents, messages, sessions } from '@cradle/db'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { injectable } from 'tsyringe'

import { DbAccessor } from '../../database/db-accessor'

@injectable()
export class SessionStore {
  constructor(private readonly dbAccessor: DbAccessor) {}

  list(workspaceId: string): Session[] {
    return this.dbAccessor
      .get()
      .select()
      .from(sessions)
      .where(eq(sessions.workspaceId, workspaceId))
      .orderBy(desc(sessions.updatedAt))
      .all()
  }

  get(id: string): Session | undefined {
    return this.dbAccessor.get().select().from(sessions).where(eq(sessions.id, id)).get()
  }

  create(input: {
    id?: string
    workspaceId: string
    title: string
    agentProfileId: string
    agentId?: string | null
    linkedIssueId?: string | null
  }): Session {
    const id = input.id ?? randomUUID()
    return this.dbAccessor
      .get()
      .insert(sessions)
      .values({
        id,
        workspaceId: input.workspaceId,
        title: input.title,
        agentProfileId: input.agentProfileId,
        agentId: input.agentId ?? null,
        linkedIssueId: input.linkedIssueId ?? null,
      })
      .returning()
      .get()
  }

  update(input: { id: string, title?: string, pinned?: boolean }): Session | undefined {
    const record = this.get(input.id)
    if (!record) {
      return undefined
    }

    const now = Math.floor(Date.now() / 1000)
    const patch: Partial<typeof sessions.$inferInsert> = { updatedAt: now }

    if (input.title !== undefined) {
      patch.title = input.title
    }

    if (input.pinned !== undefined) {
      patch.pinned = input.pinned ? 1 : 0
    }

    this.dbAccessor.get().update(sessions).set(patch).where(eq(sessions.id, input.id)).run()
    return this.get(input.id)
  }

  updateTitle(input: { id: string, title: string }): void {
    this.update(input)
  }

  delete(id: string): void {
    this.dbAccessor.get().delete(sessions).where(eq(sessions.id, id)).run()
  }

  listIdsByAgentProfile(agentProfileId: string): string[] {
    return this.dbAccessor
      .get()
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.agentProfileId, agentProfileId))
      .all()
      .map(row => row.id)
  }

  getMessages(sessionId: string): Message[] {
    return this.dbAccessor
      .get()
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.createdAt)
      .all()
  }

  getTimelineEvents(runIds: string[]): { runId: string, content: string }[] {
    if (runIds.length === 0) {
      return []
    }

    const rows = this.dbAccessor
      .get()
      .select({
        runId: backendTimelineEvents.runId,
        eventType: backendTimelineEvents.eventType,
        payloadJson: backendTimelineEvents.payloadJson,
        sequenceNumber: backendTimelineEvents.sequenceNumber,
      })
      .from(backendTimelineEvents)
      .where(inArray(backendTimelineEvents.runId, runIds))
      .orderBy(backendTimelineEvents.runId, backendTimelineEvents.sequenceNumber)
      .all()

    const chunksByRunId = new Map<string, string[]>()
    for (const row of rows) {
      const delta = readAssistantDelta(row.eventType, row.payloadJson)
      if (!delta) {
        continue
      }
      const bucket = chunksByRunId.get(row.runId) ?? []
      bucket.push(delta)
      chunksByRunId.set(row.runId, bucket)
    }

    return Array.from(chunksByRunId, ([runId, chunks]) => ({ runId, content: chunks.join('') }))
  }

  getMessagesWithRunIds(sessionId: string): Array<Message & { runId: string | null }> {
    const db = this.dbAccessor.get()
    const rows = db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.createdAt)
      .all()

    const assistantIds = rows.filter(row => row.role === 'assistant').map(row => row.id)
    const latestRunByMessageId = new Map<string, string>()

    if (assistantIds.length > 0) {
      const runs = db
        .select({
          id: backendRuns.id,
          messageId: backendRuns.messageId,
          startedAt: backendRuns.startedAt,
        })
        .from(backendRuns)
        .where(inArray(backendRuns.messageId, assistantIds))
        .orderBy(desc(backendRuns.startedAt))
        .all()

      for (const run of runs) {
        if (!run.messageId || latestRunByMessageId.has(run.messageId)) {
          continue
        }
        latestRunByMessageId.set(run.messageId, run.id)
      }
    }

    return rows.map(row => ({
      ...row,
      runId: row.role === 'assistant' ? latestRunByMessageId.get(row.id) ?? null : null,
    }))
  }
}

function readAssistantDelta(eventType: string, payloadJson: string): string | null {
  if (eventType !== 'assistant.text.delta') {
    return null
  }

  try {
    const payload = JSON.parse(payloadJson) as { delta?: unknown }
    return typeof payload.delta === 'string' ? payload.delta : null
  }
  catch {
    return null
  }
}
