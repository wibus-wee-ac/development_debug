// Input: DbAccessor + session/message/timeline tables
// Output: markdown export for a session
// Position: apps/server/src/modules/session/session.export.ts

import { desc, eq } from 'drizzle-orm'
import { injectable } from 'tsyringe'

import {
  backendRuns,
  backendSessionBindings,
  backendTimelineEvents,
  messages,
  sessions,
} from '@cradle/db'

import { DbAccessor } from '../../database/db-accessor'

@injectable()
export class SessionExport {
  constructor(private readonly dbAccessor: DbAccessor) {}

  exportMarkdown(sessionId: string): string {
    const db = this.dbAccessor.get()
    const session = db.select().from(sessions).where(eq(sessions.id, sessionId)).get()
    if (!session) {
      return ''
    }

    const msgs = db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.createdAt)
      .all()

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
      if (msg.role === 'assistant') {
        lines.push(this.extractAssistantMarkdownText(db, msg.id, msg.content))
      }
      else {
        lines.push(msg.content)
      }
      lines.push('')
    }

    return lines.join('\n')
  }

  private extractAssistantMarkdownText(
    db: ReturnType<DbAccessor['get']>,
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

    const rows = db
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
