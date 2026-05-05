// Input: shared schema helpers, identity tables, Kanban issue table, and sqlite column builders
// Output: Chat/session/message/usage tables and inferred row types
// Position: Chat persistence schema module used by chat, search, and linked-session flows

import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { agentProfiles, agents } from './identity'
import { kanbanIssues } from './kanban'
import { createdAt, textPk, timestamps, workspaces } from './shared'

export const sessions = sqliteTable('sessions', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  agentProfileId: text('agent_profile_id')
    .notNull()
    .references(() => agentProfiles.id, { onDelete: 'restrict' }),
  agentId: text('agent_id')
    .references(() => agents.id, { onDelete: 'set null' }),
  linkedIssueId: text('linked_issue_id')
    .references(() => kanbanIssues.id, { onDelete: 'set null' }),
  providerKind: text('provider_kind', {
    enum: ['acp-chat', 'cli-tui', 'openai-compatible'],
  }).notNull(),
  providerSessionId: text('provider_session_id'),
  providerStateSnapshot: text('provider_state_snapshot'),
  modelId: text('model_id'),
  configSnapshot: text('config_snapshot'),
  pinned: int('pinned').notNull().default(0),
  ...timestamps(),
})

export const messages = sqliteTable('messages', {
  id: textPk(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  status: text('status', {
    enum: ['streaming', 'complete', 'aborted', 'failed'],
  }).notNull().default('complete'),
  content: text('content').notNull(),
  errorText: text('error_text'),
  ...timestamps(),
})

export const usageLogs = sqliteTable('usage_logs', {
  id: textPk(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  messageId: text('message_id')
    .references(() => messages.id, { onDelete: 'set null' }),
  agentProfileId: text('agent_profile_id'),
  modelId: text('model_id'),
  promptTokens: int('prompt_tokens').notNull().default(0),
  completionTokens: int('completion_tokens').notNull().default(0),
  totalTokens: int('total_tokens').notNull().default(0),
  ...createdAt(),
})

export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
export type UsageLog = typeof usageLogs.$inferSelect
export type NewUsageLog = typeof usageLogs.$inferInsert
