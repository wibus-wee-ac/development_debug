import { agents, messages, sessions } from '@cradle/db'
import { and, eq, isNull } from 'drizzle-orm'

import { db } from '../../infra'

export interface ChatTurnContext {
  systemPrompt?: string
  history?: Array<{ role: 'user' | 'assistant', content: string }>
}

export function resolve(input: { sessionId: string, draftMessageId: string, draftUserMessageId: string }): ChatTurnContext {
  const session = db().select().from(sessions).where(eq(sessions.id, input.sessionId)).get()

  let systemPrompt: string | undefined
  if (session?.agentId) {
    const agent = db().select().from(agents).where(eq(agents.id, session.agentId)).get()
    systemPrompt = readAgentSystemPrompt(agent?.configJson)
  }

  const historyRows = db()
    .select()
    .from(messages)
    .where(and(eq(messages.sessionId, input.sessionId), eq(messages.status, 'complete'), isNull(messages.parentToolCallId)))
    .orderBy(messages.createdAt)
    .all()
    .filter(row => row.id !== input.draftMessageId && row.id !== input.draftUserMessageId)

  const history = historyRows.map(row => ({
    role: row.role as 'user' | 'assistant',
    content: row.content,
  })).filter(item => item.content.length > 0)

  return {
    systemPrompt,
    history: history.length > 0 ? history : undefined,
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

// Backwards-compatible class shim for old DI consumers (chat-runtime.service.ts, module.ts)
export class ChatTurnContextResolver {
  resolve(input: { sessionId: string, draftMessageId: string, draftUserMessageId: string }): ChatTurnContext {
    return resolve(input)
  }
}
