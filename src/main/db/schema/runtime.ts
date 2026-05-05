// Input: shared schema helpers, chat session table, identity tables, and sqlite column builders
// Output: Runtime session and runtime audit tables plus inferred row types
// Position: Agent runtime persistence schema module used by runtime services and providers

import { text, sqliteTable } from 'drizzle-orm/sqlite-core'
import { int } from 'drizzle-orm/sqlite-core'

import { sessions } from './chat'
import { agentProfiles } from './identity'
import { createdAt, textPk, timestamps } from './shared'

export const runtimeSessions = sqliteTable('runtime_sessions', {
  id: textPk(),
  chatSessionId: text('chat_session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  agentProfileId: text('agent_profile_id')
    .notNull()
    .references(() => agentProfiles.id, { onDelete: 'restrict' }),
  providerKind: text('provider_kind', {
    enum: ['acp-chat', 'cli-tui', 'openai-compatible'],
  }).notNull(),
  providerSessionId: text('provider_session_id'),
  providerStateSnapshot: text('provider_state_snapshot'),
  ...timestamps(),
})

export const runtimeAuditLog = sqliteTable('runtime_audit_log', {
  id: int('id').primaryKey({ autoIncrement: true }),
  agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, { onDelete: 'set null' }),
  providerKind: text('provider_kind', {
    enum: ['acp-chat', 'cli-tui', 'openai-compatible'],
  }).notNull(),
  action: text('action').notNull(),
  subject: text('subject'),
  details: text('details').notNull().default('{}'),
  ...createdAt(),
})

export type RuntimeSession = typeof runtimeSessions.$inferSelect
export type NewRuntimeSession = typeof runtimeSessions.$inferInsert
export type RuntimeAuditEntry = typeof runtimeAuditLog.$inferSelect
