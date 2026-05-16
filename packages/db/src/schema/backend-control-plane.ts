// Input: shared schema helpers, chat tables, identity tables, and sqlite column builders
// Output: Backend binding/run/capability tables plus inferred row types
// Position: Control-plane persistence schema owned by Cradle's backend session model

import { index, int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
  runtimeKind: text('runtime_kind', {
    enum: ['standard', 'claude-agent', 'codex', 'jar-core', 'acp-chat', 'cli-tui'],
  }).notNull().default('standard'),
  backendSessionId: text('backend_session_id'),
  backendStateSnapshot: text('backend_state_snapshot'),
  requestedModelId: text('requested_model_id'),
  ...timestamps(),
}, table => ({
  byAgentProfile: index('backend_session_bindings_agent_profile_id_idx').on(table.agentProfileId),
  byRuntimeKind: index('backend_session_bindings_runtime_kind_idx').on(table.runtimeKind),
}))

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
}, table => ({
  byBinding: index('backend_runs_binding_id_idx').on(table.bindingId),
  byChatSession: index('backend_runs_chat_session_id_idx').on(table.chatSessionId),
  byMessage: index('backend_runs_message_id_idx').on(table.messageId),
  byStartedAt: index('backend_runs_started_at_idx').on(table.startedAt),
}))

export const backendCapabilitySnapshots = sqliteTable('backend_capability_snapshots', {
  id: textPk(),
  agentProfileId: text('agent_profile_id')
    .notNull()
    .references(() => agentProfiles.id, { onDelete: 'restrict' }),
  runtimeKind: text('runtime_kind', {
    enum: ['standard', 'claude-agent', 'codex', 'jar-core', 'acp-chat', 'cli-tui'],
  }).notNull().default('standard'),
  source: text('source', {
    enum: ['health_check', 'session_start'],
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
