import { agents, messages, sessions } from '@cradle/db'
import { and, eq, isNull } from 'drizzle-orm'

import { readTrustedAgentRuntimeConfig } from '../../helpers/agent-runtime-config'
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
    systemPrompt = readTrustedAgentRuntimeConfig(agent?.configJson).systemPrompt
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
