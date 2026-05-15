import { randomUUID } from 'node:crypto'

import type { Message, Session } from '@cradle/db'
import type { RuntimeKind } from '../providers/types'
import {
  backendRuns,
  backendSessionBindings,
  backendTimelineEvents,
  messages,
  sessions,
} from '@cradle/db'
import { desc, eq, inArray } from 'drizzle-orm'

import { db } from '../../infra'

// ── session CRUD ──

export function list(workspaceId: string): Session[] {
  return db()
    .select()
    .from(sessions)
    .where(eq(sessions.workspaceId, workspaceId))
    .orderBy(desc(sessions.updatedAt))
    .all()
}

export function get(id: string): Session | null {
  return db().select().from(sessions).where(eq(sessions.id, id)).get() ?? null
}

export function create(input: {
  id?: string
  workspaceId: string
  title: string
  agentProfileId: string
  runtimeKind?: RuntimeKind
  agentId?: string | null
  linkedIssueId?: string | null
}): Session {
  const id = input.id ?? randomUUID()
  return db()
    .insert(sessions)
    .values({
      id,
      workspaceId: input.workspaceId,
      title: input.title,
      agentProfileId: input.agentProfileId,
      runtimeKind: input.runtimeKind ?? 'standard',
      agentId: input.agentId ?? null,
      linkedIssueId: input.linkedIssueId ?? null,
    })
    .returning()
    .get()
}

export function update(input: { id: string, title?: string, pinned?: boolean }): Session | null {
  const record = db().select().from(sessions).where(eq(sessions.id, input.id)).get()
  if (!record) {
    return null
  }

  const now = Math.floor(Date.now() / 1000)
  const patch: Partial<typeof sessions.$inferInsert> = { updatedAt: now }

  if (input.title !== undefined) {
    patch.title = input.title
  }
  if (input.pinned !== undefined) {
    patch.pinned = input.pinned ? 1 : 0
  }

  db().update(sessions).set(patch).where(eq(sessions.id, input.id)).run()
  return db().select().from(sessions).where(eq(sessions.id, input.id)).get() ?? null
}

export function updateTitle(input: { id: string, title: string }): void {
  update(input)
}

// ── cleanup hooks ──

type CleanupHandler = (sessionId: string) => void
const cleanupHandlers: CleanupHandler[] = []

export function onSessionCleanup(handler: CleanupHandler): void {
  cleanupHandlers.push(handler)
}

// ...

export function remove(id: string): void {
  for (const handler of cleanupHandlers) {
    try {
      handler(id)
    }
    catch {
      // cleanup handlers must not break the delete flow
    }
  }
  db().delete(sessions).where(eq(sessions.id, id)).run()
}

export function deleteByAgentProfile(agentProfileId: string): void {
  const ids = db()
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.agentProfileId, agentProfileId))
    .all()
    .map(row => row.id)

  for (const id of ids) {
    remove(id)
  }
}

// ── messages ──

export function getMessages(sessionId: string): Message[] {
  return db()
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt)
    .all()
}

export function getMessagesWithRunIds(sessionId: string): Array<Message & { runId: string | null }> {
  const d = db()
  const rows = d
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt)
    .all()

  const assistantIds = rows.filter(row => row.role === 'assistant').map(row => row.id)
  const latestRunByMessageId = new Map<string, string>()

  if (assistantIds.length > 0) {
    const runs = d
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

export function getTimelineEvents(runIds: string[]): { runId: string, content: string }[] {
  if (runIds.length === 0) {
    return []
  }

  const rows = db()
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

// ── export ──

export function exportMarkdown(sessionId: string): string {
  const d = db()
  const session = d.select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!session) {
    return ''
  }

  const msgs = d
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt)
    .all()

  const binding = d
    .select()
    .from(backendSessionBindings)
    .where(eq(backendSessionBindings.chatSessionId, sessionId))
    .get()

  const lines: string[] = []
  lines.push(`# ${session.title}`)
  lines.push('')
  lines.push(`> Model: ${binding?.requestedModelId ?? 'unknown'} | Created: ${new Date(session.createdAt * 1000).toLocaleString()}`)
  lines.push('')

  for (const msg of msgs) {
    const role = msg.role === 'user' ? 'User' : 'Assistant'
    lines.push(`## ${role}`)
    lines.push('')
    if (msg.role === 'assistant') {
      lines.push(extractAssistantMarkdownText(d, msg.id, msg.content))
    }
    else {
      lines.push(msg.content)
    }
    lines.push('')
  }

  return lines.join('\n')
}

// ── helpers ──

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

function extractAssistantMarkdownText(
  d: ReturnType<typeof db>,
  messageId: string,
  fallbackContent: string,
): string {
  const run = d
    .select({ id: backendRuns.id })
    .from(backendRuns)
    .where(eq(backendRuns.messageId, messageId))
    .orderBy(desc(backendRuns.startedAt))
    .get()

  if (!run) {
    return fallbackContent
  }

  const rows = d
    .select({ eventType: backendTimelineEvents.eventType, payloadJson: backendTimelineEvents.payloadJson })
    .from(backendTimelineEvents)
    .where(eq(backendTimelineEvents.runId, run.id))
    .orderBy(backendTimelineEvents.sequenceNumber)
    .all()

  const text = rows
    .filter(row => row.eventType === 'assistant.text.delta')
    .map(row => safeParseDelta(row.payloadJson))
    .join('')

  return text || fallbackContent
}

function safeParseDelta(payloadJson: string): string {
  try {
    const parsed = JSON.parse(payloadJson) as { delta?: string }
    return typeof parsed.delta === 'string' ? parsed.delta : ''
  }
  catch {
    return ''
  }
}
