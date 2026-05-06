// Input: shared schema helpers and sqlite column builders
// Output: Agent identity and credential tables plus inferred row types
// Position: Identity-layer schema module used by chat, runtime, and issue-agent contexts

import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { textPk, timestamps } from './shared'

export const agentProfiles = sqliteTable('agent_profiles', {
  id: textPk(),
  name: text('name').notNull(),
  providerKind: text('provider_kind', {
    enum: ['acp-chat', 'cli-tui', 'openai-compatible', 'codex', 'claude-agent'],
  }).notNull(),
  enabled: int('enabled', { mode: 'boolean' }).notNull().default(true),
  configJson: text('config_json').notNull().default('{}'),
  credentialRef: text('credential_ref'),
  ...timestamps(),
})

export const agentCredentials = sqliteTable('agent_credentials', {
  id: textPk(),
  providerKind: text('provider_kind', {
    enum: ['acp-chat', 'cli-tui', 'openai-compatible', 'codex', 'claude-agent'],
  }).notNull(),
  label: text('label').notNull(),
  encryptedSecret: text('encrypted_secret').notNull(),
  ...timestamps(),
})

export const agents = sqliteTable('agents', {
  id: textPk(),
  name: text('name').notNull(),
  description: text('description'),
  avatarUrl: text('avatar_url'),
  avatarStyle: text('avatar_style').notNull().default('bottts-neutral'),
  avatarSeed: text('avatar_seed').notNull(),
  providerId: text('provider_id')
    .notNull()
    .references(() => agentProfiles.id, { onDelete: 'restrict' }),
  modelId: text('model_id'),
  thinkingEffort: text('thinking_effort', {
    enum: ['low', 'medium', 'high', 'auto'],
  }).notNull().default('auto'),
  configJson: text('config_json').notNull().default('{}'),
  enabled: int('enabled', { mode: 'boolean' }).notNull().default(true),
  ...timestamps(),
})

export type AgentProfile = typeof agentProfiles.$inferSelect
export type NewAgentProfile = typeof agentProfiles.$inferInsert
export type AgentCredential = typeof agentCredentials.$inferSelect
export type NewAgentCredential = typeof agentCredentials.$inferInsert
export type Agent = typeof agents.$inferSelect
export type NewAgent = typeof agents.$inferInsert
