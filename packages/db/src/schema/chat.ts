// Input: shared schema helpers, identity tables, Kanban issue table, and sqlite column builders
// Output: Chat/session/message/usage tables and inferred row types
// Position: Chat persistence schema module used by chat, search, and linked-session flows

import { int, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { agentProfiles, agents } from './identity'
import { kanbanIssues } from './kanban'
import { createdAt, textPk, timestamps, workspaces } from './shared'

export const sessions = sqliteTable('sessions', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  agentProfileId: text('agent_profile_id')
    .notNull()
    .references(() => agentProfiles.id, { onDelete: 'restrict' }),
  runtimeKind: text('runtime_kind', {
    enum: ['standard', 'claude-agent', 'codex', 'jar-core', 'acp-chat', 'cli-tui'],
  }).notNull().default('standard'),
  agentId: text('agent_id')
    .references(() => agents.id, { onDelete: 'set null' }),
  linkedIssueId: text('linked_issue_id')
    .references(() => kanbanIssues.id, { onDelete: 'set null' }),
  pinned: int('pinned').notNull().default(0),
  ptyStartedAt: int('pty_started_at'),
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
})

export const approvalAudit = sqliteTable('approval_audit', {
  id: textPk(),
  sessionId: text('session_id')
    .references(() => sessions.id, { onDelete: 'cascade' }),
  toolName: text('tool_name').notNull(),
  decision: text('decision', { enum: ['approved', 'rejected'] }).notNull(),
  selectedOptionId: text('selected_option_id').notNull(),
  ...createdAt(),
})

export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
export type UsageLog = typeof usageLogs.$inferSelect
export type NewUsageLog = typeof usageLogs.$inferInsert
export type StepUsageRow = typeof stepUsage.$inferSelect
export type NewStepUsageRow = typeof stepUsage.$inferInsert
export type ApprovalAuditRow = typeof approvalAudit.$inferSelect
export type NewApprovalAuditRow = typeof approvalAudit.$inferInsert
