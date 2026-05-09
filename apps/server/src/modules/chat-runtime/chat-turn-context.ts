// Input: chat/session/agent rows and timeline-backed assistant text extraction
// Output: minimal turn context resolver for system prompt and chat history
// Position: apps/server/src/modules/chat-runtime/chat-turn-context.ts

import { agents, backendRuns, backendTimelineEvents, messages, sessions } from '@cradle/db'
import { and, desc, eq } from 'drizzle-orm'
import { inject, injectable } from 'tsyringe'

import { DbAccessor } from '../../database/db-accessor'
import { decodeTimelineInputEvent } from './timeline-events'

export interface ChatTurnContext {
  systemPrompt?: string
  history?: Array<{ role: 'user' | 'assistant', content: string }>
}

@injectable()
export class ChatTurnContextResolver {
  constructor(@inject(DbAccessor) private readonly dbAccessor: DbAccessor) {}

  resolve(input: { sessionId: string, draftMessageId: string, draftUserMessageId: string }): ChatTurnContext {
    const db = this.dbAccessor.get()
    const session = db.select().from(sessions).where(eq(sessions.id, input.sessionId)).get()

    let systemPrompt: string | undefined
    if (session?.agentId) {
      const agent = db.select().from(agents).where(eq(agents.id, session.agentId)).get()
      systemPrompt = readAgentSystemPrompt(agent?.configJson)
    }

    const historyRows = db.select().from(messages).where(and(eq(messages.sessionId, input.sessionId), eq(messages.status, 'complete'))).orderBy(messages.createdAt).all().filter(row => row.id !== input.draftMessageId && row.id !== input.draftUserMessageId)

    const history = historyRows.map(row => ({
      role: row.role as 'user' | 'assistant',
      content: row.role === 'assistant' ? this.readAssistantText(row.id) : row.content,
    })).filter(item => item.content.length > 0)

    return {
      systemPrompt,
      history: history.length > 0 ? history : undefined,
    }
  }

  private readAssistantText(messageId: string): string {
    const db = this.dbAccessor.get()
    const run = db.select({ id: backendRuns.id }).from(backendRuns).where(eq(backendRuns.messageId, messageId)).orderBy(desc(backendRuns.startedAt)).get()
    if (!run) {
      return ''
    }
    const rows = db.select().from(backendTimelineEvents).where(eq(backendTimelineEvents.runId, run.id)).orderBy(backendTimelineEvents.sequenceNumber).all()
    return rows.map((row) => {
      const event = decodeTimelineInputEvent({ eventType: row.eventType, payloadJson: row.payloadJson, sourceJson: row.sourceJson })
      return event.type === 'assistant.text.delta' ? event.delta : ''
    }).join('')
  }
}

function readAgentSystemPrompt(configJson: string | null | undefined): string | undefined {
  if (!configJson) {
    return undefined
  }
  try {
    const parsed = JSON.parse(configJson) as { systemPrompt?: unknown }
    return typeof parsed.systemPrompt === 'string' && parsed.systemPrompt.length > 0 ? parsed.systemPrompt : undefined
  }
  catch {
    return undefined
  }
}
