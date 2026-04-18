import { randomUUID } from 'node:crypto'

import { IpcMethod, IpcService } from '@cradle/ipc'
import { desc, eq } from 'drizzle-orm'

import { getDb } from '../db'
import type { Message, Session } from '../db/schema'
import { messages, sessions } from '../db/schema'

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
    agent: string
    id?: string
    /** ACP transport session ID to associate. */
    acpSessionId?: string
    /** Snapshot of the initial model ID. */
    modelId?: string
    /** JSON snapshot of initial config options. */
    configSnapshot?: string
  }): Session {
    const db = getDb()
    const id = input.id ?? randomUUID()
    const result = db
      .insert(sessions)
      .values({
        id,
        workspaceId: input.workspaceId,
        title: input.title,
        agent: input.agent,
        acpSessionId: input.acpSessionId ?? null,
        modelId: input.modelId ?? null,
        configSnapshot: input.configSnapshot ?? null,
      })
      .returning()
      .get()
    return result
  }

  @IpcMethod()
  delete(id: string): void {
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
  addMessage(input: { sessionId: string, role: 'user' | 'assistant', content: string }): Message {
    const db = getDb()
    const result = db
      .insert(messages)
      .values({ sessionId: input.sessionId, role: input.role, content: input.content })
      .returning()
      .get()

    // Bump session updatedAt
    db.update(sessions)
      .set({ updatedAt: Math.floor(Date.now() / 1000) })
      .where(eq(sessions.id, input.sessionId))
      .run()

    return result
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
}
