// Input: identity tables, shared schema helpers, and sqlite column builders
// Output: Runtime audit table plus inferred row types
// Position: Agent runtime persistence schema module for provider health checks and model audit events

import { sql } from 'drizzle-orm'
import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { agentProfiles } from './identity'
import { createdAt } from './shared'

export const runtimeAuditLog = sqliteTable('runtime_audit_log', {
  id: int('id').primaryKey({ autoIncrement: true }),
  agentProfileId: text('agent_profile_id').references(() => agentProfiles.id, { onDelete: 'set null' }),
  providerKind: text('provider_kind', {
    enum: ['openai-compatible', 'anthropic'],
  }).notNull(),
  action: text('action').notNull(),
  subject: text('subject'),
  details: text('details').notNull().default('{}'),
  ...createdAt(),
})

export type RuntimeAuditEntry = typeof runtimeAuditLog.$inferSelect

export const providerModelCache = sqliteTable('provider_model_cache', {
  profileId: text('profile_id').primaryKey().references(() => agentProfiles.id, { onDelete: 'cascade' }),
  modelsJson: text('models_json').notNull().default('[]'),
  fetchedAt: int('fetched_at').notNull().default(sql`(unixepoch())`),
})

export type ProviderModelCacheRow = typeof providerModelCache.$inferSelect
