import { index, int, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { agents } from './identity'
import { issues } from './issue'
import { providerTargets } from './provider-target'
import { createdAt, textPk, timestamps, workspaces } from './shared'

export const sessions = sqliteTable('sessions', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  providerTargetId: text('provider_target_id')
    .references(() => providerTargets.id, { onDelete: 'restrict' }),
  runtimeKind: text('runtime_kind', {
    enum: ['standard', 'claude-agent', 'codex', 'jar-core', 'acp-chat', 'cli-tui'],
  }).notNull().default('standard'),
  agentId: text('agent_id')
    .references(() => agents.id, { onDelete: 'set null' }),
  configJson: text('config_json').notNull().default('{}'),
  linkedIssueId: text('linked_issue_id')
    .references(() => issues.id, { onDelete: 'set null' }),
  pinned: int('pinned').notNull().default(0),
  ptyStartedAt: int('pty_started_at'),
  ...timestamps(),
}, table => ({
  byWorkspace: index('sessions_workspace_id_idx').on(table.workspaceId),
  byProviderTarget: index('sessions_provider_target_id_idx').on(table.providerTargetId),
  byLinkedIssue: index('sessions_linked_issue_id_idx').on(table.linkedIssueId),
}))

export const messages = sqliteTable('messages', {
  id: textPk(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  parentMessageId: text('parent_message_id'),
  parentToolCallId: text('parent_tool_call_id'),
  taskId: text('task_id'),
  depth: int('depth').notNull().default(0),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  status: text('status', {
    enum: ['streaming', 'complete', 'aborted', 'failed'],
  }).notNull().default('complete'),
  content: text('content').notNull(),
  messageJson: text('message_json').notNull(),
  errorText: text('error_text'),
  ...timestamps(),
}, table => ({
  bySession: index('messages_session_id_idx').on(table.sessionId),
  bySessionCreatedAt: index('messages_session_created_at_idx').on(table.sessionId, table.createdAt),
  byParentToolCall: index('messages_parent_tool_call_id_idx').on(table.parentToolCallId),
}))

export const usageLogs = sqliteTable('usage_logs', {
  id: textPk(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  messageId: text('message_id')
    .references(() => messages.id, { onDelete: 'set null' }),
  providerTargetId: text('provider_target_id')
    .references(() => providerTargets.id, { onDelete: 'set null' }),
  modelId: text('model_id'),
  promptTokens: int('prompt_tokens').notNull().default(0),
  completionTokens: int('completion_tokens').notNull().default(0),
  totalTokens: int('total_tokens').notNull().default(0),
  ...createdAt(),
}, table => ({
  bySession: index('usage_logs_session_id_idx').on(table.sessionId),
  byMessage: index('usage_logs_message_id_idx').on(table.messageId),
  byProviderTarget: index('usage_logs_provider_target_id_idx').on(table.providerTargetId),
}))

export const stepUsage = sqliteTable('step_usage', {
  id: textPk(),
  runId: text('run_id').notNull(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  stepNumber: int('step_number').notNull(),
  stepType: text('step_type').notNull(),
  modelId: text('model_id'),
  promptTokens: int('prompt_tokens').notNull().default(0),
  completionTokens: int('completion_tokens').notNull().default(0),
  totalTokens: int('total_tokens').notNull().default(0),
  estimatedCostUsd: real('estimated_cost_usd').notNull().default(0),
  ...createdAt(),
}, table => ({
  byRun: index('step_usage_run_id_idx').on(table.runId),
  bySession: index('step_usage_session_id_idx').on(table.sessionId),
}))

export const chatSessionQueueItems = sqliteTable('chat_session_queue_items', {
  id: textPk(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  mode: text('mode', { enum: ['queue', 'steer'] }).notNull(),
  status: text('status', {
    enum: ['pending', 'running', 'cancelled', 'completed', 'failed'],
  }).notNull().default('pending'),
  text: text('text').notNull(),
  filesJson: text('files_json').notNull().default('[]'),
  providerTargetId: text('provider_target_id')
    .references(() => providerTargets.id, { onDelete: 'set null' }),
  modelId: text('model_id'),
  thinkingEffort: text('thinking_effort', {
    enum: ['low', 'medium', 'high'],
  }),
  position: int('position').notNull(),
  sourceRunId: text('source_run_id'),
  startedRunId: text('started_run_id'),
  errorText: text('error_text'),
  ...timestamps(),
}, table => ({
  bySessionStatusPosition: index('chat_session_queue_items_session_status_position_idx')
    .on(table.sessionId, table.status, table.position),
  bySessionCreatedAt: index('chat_session_queue_items_session_created_at_idx')
    .on(table.sessionId, table.createdAt),
  byProviderTarget: index('chat_session_queue_items_provider_target_id_idx').on(table.providerTargetId),
  byStartedRun: index('chat_session_queue_items_started_run_id_idx').on(table.startedRunId),
}))

export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
export type UsageLog = typeof usageLogs.$inferSelect
export type NewUsageLog = typeof usageLogs.$inferInsert
export type StepUsageRow = typeof stepUsage.$inferSelect
export type NewStepUsageRow = typeof stepUsage.$inferInsert
export type ChatSessionQueueItem = typeof chatSessionQueueItems.$inferSelect
export type NewChatSessionQueueItem = typeof chatSessionQueueItems.$inferInsert
