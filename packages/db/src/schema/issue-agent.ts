// Input: shared schema helpers, Kanban issue table, chat session table, identity tables, and sqlite column builders
// Output: Issue-agent session/activity tables plus inferred row types
// Position: Issue-agent persistence schema module used by delegation flows and agent runtime orchestration

import { text, sqliteTable } from 'drizzle-orm/sqlite-core'

import { sessions } from './chat'
import { agentProfiles } from './identity'
import { kanbanIssues } from './kanban'
import { createdAt, textPk, timestamps } from './shared'

export const agentSessions = sqliteTable('agent_sessions', {
  id: textPk(),
  issueId: text('issue_id')
    .notNull()
    .references(() => kanbanIssues.id, { onDelete: 'cascade' }),
  agentProfileId: text('agent_profile_id')
    .notNull()
    .references(() => agentProfiles.id, { onDelete: 'restrict' }),
  chatSessionId: text('chat_session_id')
    .references(() => sessions.id, { onDelete: 'set null' }),
  status: text('status', {
    enum: ['created', 'active', 'completed', 'stopped', 'failed'],
  }).notNull().default('created'),
  ...timestamps(),
})

export const agentActivities = sqliteTable('agent_activities', {
  id: textPk(),
  agentSessionId: text('agent_session_id')
    .notNull()
    .references(() => agentSessions.id, { onDelete: 'cascade' }),
  type: text('type', {
    enum: ['thought', 'action', 'response', 'elicitation', 'error', 'prompt'],
  }).notNull(),
  content: text('content').notNull(),
  signal: text('signal'),
  signalMetadata: text('signal_metadata'),
  ...createdAt(),
})

export type AgentSession = typeof agentSessions.$inferSelect
export type NewAgentSession = typeof agentSessions.$inferInsert
export type AgentActivity = typeof agentActivities.$inferSelect
export type NewAgentActivity = typeof agentActivities.$inferInsert
