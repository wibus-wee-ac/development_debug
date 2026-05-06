// Input: @cradle/ipc decorators, drizzle-orm, and DB schema
// Output: SessionService — IPC surface for session CRUD and message reads (writes owned by ChatEngine)
// Position: Main-process IPC service for session metadata and message reads; backend control-plane state is persisted elsewhere

import { randomUUID } from 'node:crypto'

import { IpcMethod, IpcService } from '@cradle/ipc'
import { desc, eq } from 'drizzle-orm'

import { getDb } from '../../db'
import type { Message, Session } from '../../db/schema'
import { backendRuns, backendSessionBindings, backendTimelineEvents, messages, sessions } from '../../db/schema'
import { ptyManager } from '../../pty/pty-manager'
import { threadSearchEngine } from '../../chat/thread-search'

export class SessionService extends IpcService {
  static readonly groupName = 'session'

  @IpcMethod()
  list(workspaceId: string): Session[] {
    return getDb()
      .select()
      .from(sessions)
      .where(eq(sessions.workspaceId, workspaceId))
      .orderBy(desc(sessions.updatedAt))
      .all()
  }

  @IpcMethod()
  get(id: string): Session | undefined {
    return getDb().select().from(sessions).where(eq(sessions.id, id)).get()
  }

  @IpcMethod()
  create(input: {
    workspaceId: string
    title: string
    agentProfileId: string
    id?: string
  }): Session {
    const db = getDb()
    const id = input.id ?? randomUUID()
    const result = db
      .insert(sessions)
      .values({
        id,
        workspaceId: input.workspaceId,
        title: input.title,
        agentProfileId: input.agentProfileId,
      })
      .returning()
      .get()
    return result
  }

  @IpcMethod()
  delete(id: string): void {
    // Stop PTY if this session has an active terminal process
    ptyManager.stop(id)
    // Remove FTS index entries before deleting the session
    threadSearchEngine.removeSessionFromIndex(id)
    getDb().delete(sessions).where(eq(sessions.id, id)).run()
  }

  @IpcMethod()
  updateTitle(input: { id: string, title: string }): void {
    getDb()
      .update(sessions)
      .set({ title: input.title, updatedAt: Math.floor(Date.now() / 1000) })
      .where(eq(sessions.id, input.id))
      .run()
  }

  @IpcMethod()
  getMessages(sessionId: string): Message[] {
    return getDb()
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.createdAt)
      .all()
  }

  @IpcMethod()
  togglePin(id: string): boolean {
    const db = getDb()
    const session = db.select().from(sessions).where(eq(sessions.id, id)).get()
    if (!session) {
      return false
    }
    const newPinned = session.pinned ? 0 : 1
    db.update(sessions)
      .set({ pinned: newPinned })
      .where(eq(sessions.id, id))
      .run()
    return newPinned === 1
  }

  @IpcMethod()
  exportAsMarkdown(sessionId: string): string {
    const db = getDb()
    const session = db.select().from(sessions).where(eq(sessions.id, sessionId)).get()
    if (!session) {
      return ''
    }
    const msgs = db.select().from(messages).where(eq(messages.sessionId, sessionId)).orderBy(messages.createdAt).all()
    const binding = db
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
      lines.push(msg.role === 'assistant' ? extractAssistantMarkdownText(db, msg.id, msg.content) : msg.content)
      lines.push('')
    }

    return lines.join('\n')
  }
}

function extractAssistantMarkdownText(
  db: ReturnType<typeof getDb>,
  messageId: string,
  fallbackContent: string,
): string {
  const run = db
    .select({ id: backendRuns.id })
    .from(backendRuns)
    .where(eq(backendRuns.messageId, messageId))
    .orderBy(desc(backendRuns.startedAt))
    .get()

  if (!run) {
    return fallbackContent
  }

  const assistantText = db
    .select({ payloadJson: backendTimelineEvents.payloadJson })
    .from(backendTimelineEvents)
    .where(eq(backendTimelineEvents.runId, run.id))
    .orderBy(backendTimelineEvents.sequenceNumber)
    .all()
    .map(row => JSON.parse(row.payloadJson) as { type: string, delta?: string })
    .filter(event => event.type === 'assistant.text.delta')
    .map(event => event.delta ?? '')
    .join('')

  return assistantText || fallbackContent
}
