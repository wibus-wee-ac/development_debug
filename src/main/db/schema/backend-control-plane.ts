// Input: shared schema helpers, chat tables, identity tables, and sqlite column builders
// Output: Backend binding/run/capability tables plus inferred row types
// Position: Control-plane persistence schema owned by Cradle's backend session model

import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { messages, sessions } from './chat'
import { agentProfiles } from './identity'
import { textPk, timestamps } from './shared'

export const backendSessionBindings = sqliteTable('backend_session_bindings', {
  id: textPk(),
  chatSessionId: text('chat_session_id')
    .notNull()
    .unique()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  agentProfileId: text('agent_profile_id')
    .notNull()
    .references(() => agentProfiles.id, { onDelete: 'restrict' }),
  providerKind: text('provider_kind', {
    enum: ['acp-chat', 'cli-tui', 'openai-compatible'],
  }).notNull(),
  backendSessionId: text('backend_session_id'),
  backendStateSnapshot: text('backend_state_snapshot'),
  requestedModelId: text('requested_model_id'),
  configSnapshot: text('config_snapshot'),
  ...timestamps(),
})

export const backendRuns = sqliteTable('backend_runs', {
  id: textPk(),
  bindingId: text('binding_id')
    .notNull()
    .references(() => backendSessionBindings.id, { onDelete: 'cascade' }),
  chatSessionId: text('chat_session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  messageId: text('message_id').references(() => messages.id, { onDelete: 'set null' }),
  origin: text('origin', {
    enum: ['user', 'issue-agent', 'system'],
  }).notNull(),
  status: text('status', {
    enum: ['streaming', 'complete', 'aborted', 'failed'],
  }).notNull(),
  stopReason: text('stop_reason'),
  errorText: text('error_text'),
  startedAt: int('started_at').notNull(),
  finishedAt: int('finished_at'),
})

export const backendCapabilitySnapshots = sqliteTable('backend_capability_snapshots', {
  id: textPk(),
  agentProfileId: text('agent_profile_id')
    .notNull()
    .references(() => agentProfiles.id, { onDelete: 'restrict' }),
  providerKind: text('provider_kind', {
    enum: ['acp-chat', 'cli-tui', 'openai-compatible'],
  }).notNull(),
  source: text('source', {
    enum: ['probe', 'session_start'],
  }).notNull(),
  capabilitiesJson: text('capabilities_json').notNull(),
  recordedAt: int('recorded_at').notNull(),
})

export type BackendSessionBinding = typeof backendSessionBindings.$inferSelect
export type NewBackendSessionBinding = typeof backendSessionBindings.$inferInsert
export type BackendRun = typeof backendRuns.$inferSelect
export type NewBackendRun = typeof backendRuns.$inferInsert
export type BackendCapabilitySnapshot = typeof backendCapabilitySnapshots.$inferSelect
export type NewBackendCapabilitySnapshot = typeof backendCapabilitySnapshots.$inferInsert
