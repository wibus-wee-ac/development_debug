import { randomUUID } from 'node:crypto'

import { sessionAwaits, sessions, workspaces } from '@cradle/db'
import { and, eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import { createRun } from '../chat-runtime/service'
import type {
  RegisterAwaitInput,
  SessionAwait,
  SessionAwaitSummary,
  TriggerAwaitInput,
} from './types'

// ── write operations ──

export function register(input: RegisterAwaitInput): SessionAwait {
  // Validate filterJson is valid JSON
  try {
    JSON.parse(input.filterJson)
  }
  catch {
    throw new AppError({ code: 'invalid_filter_json', status: 400, message: 'filterJson must be valid JSON' })
  }

  // Validate referenced session exists
  const sessionExists = db().select({ id: sessions.id }).from(sessions).where(eq(sessions.id, input.chatSessionId)).get()
  if (!sessionExists) {
    throw new AppError({ code: 'session_not_found', status: 404, message: 'Chat session not found' })
  }

  // Validate referenced workspace exists
  const workspaceExists = db().select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, input.workspaceId)).get()
  if (!workspaceExists) {
    throw new AppError({ code: 'workspace_not_found', status: 404, message: 'Workspace not found' })
  }

  const id = randomUUID()
  return db()
    .insert(sessionAwaits)
    .values({
      id,
      chatSessionId: input.chatSessionId,
      workspaceId: input.workspaceId,
      source: input.source,
      filterJson: input.filterJson,
      reason: input.reason ?? null,
      expiresAt: input.expiresAt ?? null,
      fireAt: input.fireAt ?? null,
    })
    .returning()
    .get()
}

export function cancel(awaitId: string): SessionAwait | null {
  return db()
    .update(sessionAwaits)
    .set({ status: 'cancelled' })
    .where(and(
      eq(sessionAwaits.id, awaitId),
      eq(sessionAwaits.status, 'pending'),
    ))
    .returning()
    .get() ?? null
}

export function expire(awaitId: string): SessionAwait | null {
  return db()
    .update(sessionAwaits)
    .set({ status: 'expired' })
    .where(and(
      eq(sessionAwaits.id, awaitId),
      eq(sessionAwaits.status, 'pending'),
    ))
    .returning()
    .get() ?? null
}

export async function trigger(input: TriggerAwaitInput): Promise<SessionAwait | null> {
  const row = db()
    .select()
    .from(sessionAwaits)
    .where(eq(sessionAwaits.id, input.awaitId))
    .get()

  if (!row) {
    return null
  }
  if (row.status === 'triggered') {
    return row
  } // idempotent

  if (row.status !== 'pending') {
    return null
  }

  const now = Math.floor(Date.now() / 1000)

  // Mark as triggered before dispatching resume to guarantee idempotency
  const updated = db()
    .update(sessionAwaits)
    .set({
      status: 'triggered',
      triggeredAt: now,
      resumePayloadJson: input.resumePayloadJson ?? null,
    })
    .where(and(
      eq(sessionAwaits.id, input.awaitId),
      eq(sessionAwaits.status, 'pending'),
    ))
    .returning()
    .get()

  if (!updated) {
    return row
  } // another trigger won the race

  // Resume the chat session — rollback status on failure
  try {
    await createRun({
      sessionId: row.chatSessionId,
      text: input.resumeText,
    })
  }
  catch (err) {
    // Rollback to pending so poller can retry, or mark failed for persistent errors
    const errorText = err instanceof Error ? err.message : String(err)
    const isSessionBusy = (err instanceof AppError && err.status === 409)
      || errorText.includes('active run')
    db()
      .update(sessionAwaits)
      .set({
        status: isSessionBusy ? 'pending' : 'failed',
        triggeredAt: null,
        lastErrorText: errorText,
        lastCheckedAt: now,
      })
      .where(eq(sessionAwaits.id, input.awaitId))
      .run()

    return db().select().from(sessionAwaits).where(eq(sessionAwaits.id, input.awaitId)).get() ?? null
  }

  return updated
}

export function markFailed(awaitId: string, errorText: string): void {
  const now = Math.floor(Date.now() / 1000)
  db()
    .update(sessionAwaits)
    .set({ status: 'failed', lastErrorText: errorText, lastCheckedAt: now })
    .where(and(
      eq(sessionAwaits.id, awaitId),
      eq(sessionAwaits.status, 'pending'),
    ))
    .run()
}

export function updateLastChecked(awaitId: string, errorText?: string): void {
  const now = Math.floor(Date.now() / 1000)
  db()
    .update(sessionAwaits)
    .set({
      lastCheckedAt: now,
      lastErrorText: errorText ?? null,
    })
    .where(eq(sessionAwaits.id, awaitId))
    .run()
}

// ── read operations ──

export function get(awaitId: string): SessionAwait | null {
  return db()
    .select()
    .from(sessionAwaits)
    .where(eq(sessionAwaits.id, awaitId))
    .get() ?? null
}

export function listBySession(sessionId: string): SessionAwait[] {
  return db()
    .select()
    .from(sessionAwaits)
    .where(eq(sessionAwaits.chatSessionId, sessionId))
    .all()
}

export function listPendingBySource(source: string): SessionAwait[] {
  return db()
    .select()
    .from(sessionAwaits)
    .where(and(
      eq(sessionAwaits.source, source),
      eq(sessionAwaits.status, 'pending'),
    ))
    .all()
}

export function listAllPending(): SessionAwait[] {
  return db()
    .select()
    .from(sessionAwaits)
    .where(eq(sessionAwaits.status, 'pending'))
    .all()
}

export function getSessionSummary(sessionId: string): SessionAwaitSummary {
  const pending = db()
    .select()
    .from(sessionAwaits)
    .where(and(
      eq(sessionAwaits.chatSessionId, sessionId),
      eq(sessionAwaits.status, 'pending'),
    ))
    .all()

  if (pending.length === 0) {
    return { awaiting: false, pendingCount: 0, primarySource: null, reason: null }
  }

  const first = pending[0]
  return {
    awaiting: true,
    pendingCount: pending.length,
    primarySource: first.source,
    reason: first.reason,
  }
}
