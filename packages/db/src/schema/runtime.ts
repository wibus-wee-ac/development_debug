// Input: identity tables, shared schema helpers, and sqlite column builders
// Output: Runtime audit table plus inferred row types
// Position: Agent runtime persistence schema module for provider health checks and model audit events

import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { agentProfiles } from './identity'
import { createdAt } from './shared'

export const runtimeAuditLog = sqliteTable('runtime_audit_log', {
  id: int('id').primaryKey({ autoIncrement: true }),
  agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, { onDelete: 'set null' }),
  providerKind: text('provider_kind', {
    enum: ['acp-chat', 'cli-tui', 'openai-compatible', 'codex', 'claude-agent', 'system-agent'],
  }).notNull(),
  action: text('action').notNull(),
  subject: text('subject'),
  details: text('details').notNull().default('{}'),
  ...createdAt(),
})

export type RuntimeAuditEntry = typeof runtimeAuditLog.$inferSelect
