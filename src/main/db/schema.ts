// Input: drizzle-orm sqlite schema builders
// Output: SQLite table definitions and inferred row types for workspaces, chat sessions, unified agent runtime tables, and Kanban entities
// Position: Main-process persistence schema shared by DB initialization and services

import { sql } from 'drizzle-orm'
import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// ── Shared column fragments ───────────────────────────────────────────────────

const textPk = () => text('id').primaryKey()

const timestamps = () => ({
  createdAt: int('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt: int('updated_at').notNull().default(sql`(unixepoch())`),
})

const createdAt = () => ({
  createdAt: int('created_at').notNull().default(sql`(unixepoch())`),
})

// ── Tables ────────────────────────────────────────────────────────────────────

export const workspaces = sqliteTable('workspaces', {
  id: textPk(),
  name: text('name').notNull(),
  path: text('path').notNull().unique(),
  ...timestamps(),
})

export const sessions = sqliteTable('sessions', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  agentProfileId: text('agent_profile_id')
    .notNull()
    .references(() => agentProfiles.id, { onDelete: 'restrict' }),
  /** Optional Agent identity ID — set when a chat is started from an Agent (vs. raw Provider). */
  agentId: text('agent_id')
    .references(() => agents.id, { onDelete: 'set null' }),
  /** Manually linked issue. Null when the session has no manual association (auto-links go through agentSessions). */
  linkedIssueId: text('linked_issue_id')
    .references(() => kanbanIssues.id, { onDelete: 'set null' }),
  providerKind: text('provider_kind', {
    enum: ['acp-chat', 'cli-tui', 'openai-compatible'],
  }).notNull(),
  /** Provider-owned session handle such as an ACP session id, Codex thread id, or PTY id. */
  providerSessionId: text('provider_session_id'),
  /** JSON object with provider-specific resumable state. */
  providerStateSnapshot: text('provider_state_snapshot'),
  /** Model ID snapshot captured at session creation. Shown when no active ACP session. */
  modelId: text('model_id'),
  /** JSON array of SessionConfigOption snapshots captured at creation. */
  configSnapshot: text('config_snapshot'),
  /** Whether this session is pinned/bookmarked by the user. */
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
  })
    .notNull()
    .default('complete'),
  content: text('content').notNull(),
  errorText: text('error_text'),
  ...timestamps(),
})

export const agentProfiles = sqliteTable('agent_profiles', {
  id: textPk(),
  name: text('name').notNull(),
  providerKind: text('provider_kind', {
    enum: ['acp-chat', 'cli-tui', 'openai-compatible'],
  }).notNull(),
  enabled: int('enabled', { mode: 'boolean' }).notNull().default(true),
  configJson: text('config_json').notNull().default('{}'),
  credentialRef: text('credential_ref'),
  ...timestamps(),
})

export const agentCredentials = sqliteTable('agent_credentials', {
  id: textPk(),
  providerKind: text('provider_kind', {
    enum: ['acp-chat', 'cli-tui', 'openai-compatible'],
  }).notNull(),
  label: text('label').notNull(),
  encryptedSecret: text('encrypted_secret').notNull(),
  ...timestamps(),
})

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

// ── ACP tables ────────────────────────────────────────────────────────────────

export const acpAgents = sqliteTable('acp_agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  version: text('version').notNull(),
  distributionType: text('distribution_type').notNull(),
  installPath: text('install_path'),
  cmd: text('cmd'),
  args: text('args').notNull().default('[]'),
  env: text('env').notNull().default('{}'),
  status: text('status').notNull().default('installing'),
  ...timestamps(),
})

export const acpAuditLog = sqliteTable('acp_audit_log', {
  id: int('id').primaryKey({ autoIncrement: true }),
  agentId: text('agent_id').notNull(),
  action: text('action').notNull(),
  path: text('path'),
  details: text('details').notNull().default('{}'),
  ...createdAt(),
})

// ── Usage tracking ────────────────────────────────────────────────────────────

/** Per-turn token usage log, tied to a session and optionally a message. */
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

// ── Inferred types ────────────────────────────────────────────────────────────

export type Workspace = typeof workspaces.$inferSelect
export type NewWorkspace = typeof workspaces.$inferInsert
export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
export type AgentProfile = typeof agentProfiles.$inferSelect
export type NewAgentProfile = typeof agentProfiles.$inferInsert
export type AgentCredential = typeof agentCredentials.$inferSelect
export type NewAgentCredential = typeof agentCredentials.$inferInsert
export type RuntimeSession = typeof runtimeSessions.$inferSelect
export type NewRuntimeSession = typeof runtimeSessions.$inferInsert
export type RuntimeAuditEntry = typeof runtimeAuditLog.$inferSelect
export type AcpAgent = typeof acpAgents.$inferSelect
export type AcpAuditEntry = typeof acpAuditLog.$inferSelect
export type UsageLog = typeof usageLogs.$inferSelect
export type NewUsageLog = typeof usageLogs.$inferInsert

// ── Kanban tables ─────────────────────────────────────────────────────────────

/** Ordered set of status values for issues within a workspace. Visually renders as board columns. */
export const kanbanStatuses = sqliteTable('kanban_statuses', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** CSS hex color for column header tinting, e.g. "#6366f1". */
  color: text('color'),
  /** Display order (left-to-right). Lower value = leftmost. */
  order: int('order').notNull().default(0),
  ...createdAt(),
})

/** A named, persisted Kanban view for a workspace. filterConfig is a JSON blob. */
export const kanbanBoards = sqliteTable('kanban_boards', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** JSON: { milestoneId?, priority?, labels? } — saved board filter defaults. */
  filterConfig: text('filter_config'),
  ...timestamps(),
})

/** A milestone groups issues by deadline within a workspace. */
export const kanbanMilestones = sqliteTable('kanban_milestones', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  /** Unix epoch (seconds). Null = no deadline. */
  dueDate: int('due_date'),
  status: text('status', { enum: ['open', 'closed'] }).notNull().default('open'),
  ...timestamps(),
})

/** Core issue entity. Belongs to a workspace; optionally tied to a status, milestone, and parent issue. */
export const kanbanIssues = sqliteTable('kanban_issues', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  /** Current status column. Null = unassigned / backlog. */
  statusId: text('status_id').references(() => kanbanStatuses.id, { onDelete: 'set null' }),
  milestoneId: text('milestone_id').references(() => kanbanMilestones.id, { onDelete: 'set null' }),
  /**
   * Parent issue ID for sub-issues. Plain text (no Drizzle .references()) because
   * Drizzle does not support self-referential FK declarations. Application layer
   * must set this to null on child issues before deleting the parent.
   */
  parentIssueId: text('parent_issue_id'),
  title: text('title').notNull(),
  /** Markdown body. */
  description: text('description'),
  priority: text('priority', {
    enum: ['none', 'low', 'medium', 'high', 'urgent'],
  }).notNull().default('none'),
  /** JSON array of label strings, e.g. '["bug","frontend"]'. */
  labels: text('labels').notNull().default('[]'),
  /** Assignee kind: 'user' for human, null for unassigned. */
  assigneeKind: text('assignee_kind'),
  /** Assignee identifier: '__self__' for the local user. */
  assigneeId: text('assignee_id'),
  /** Delegated agent profile ID. When set, an agent is actively working on this issue. */
  delegateAgentId: text('delegate_agent_id'),
  /** JSON array of context references: [{ type, id?, path?, url?, text? }]. */
  contextRefs: text('context_refs').notNull().default('[]'),
  ...timestamps(),
})

/** Append-only comments on an issue. */
export const kanbanIssueComments = sqliteTable('kanban_issue_comments', {
  id: textPk(),
  issueId: text('issue_id')
    .notNull()
    .references(() => kanbanIssues.id, { onDelete: 'cascade' }),
  /** Markdown body. */
  content: text('content').notNull(),
  /** Author kind: 'user' (human), 'agent', or 'system'. */
  authorKind: text('author_kind', {
    enum: ['user', 'agent', 'system'],
  }).notNull().default('user'),
  /** Author ID: agent profile ID for 'agent', '__self__' for 'user', null for 'system'. */
  authorId: text('author_id'),
  /** Optional link to the source agent activity that generated this comment. */
  agentActivityId: text('agent_activity_id'),
  ...createdAt(),
})

/**
 * Directed relationships between two issues.
 * type='blocks' means source blocks target; inverse (is_blocked_by) is derived at query time.
 * type='relates_to' is symmetric; direction is ignored in the UI.
 */
export const kanbanIssueRelations = sqliteTable('kanban_issue_relations', {
  id: textPk(),
  sourceIssueId: text('source_issue_id')
    .notNull()
    .references(() => kanbanIssues.id, { onDelete: 'cascade' }),
  targetIssueId: text('target_issue_id')
    .notNull()
    .references(() => kanbanIssues.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['blocks', 'duplicates', 'relates_to'] }).notNull(),
  ...createdAt(),
})

// ── Kanban inferred types ─────────────────────────────────────────────────────

export type KanbanStatus = typeof kanbanStatuses.$inferSelect
export type KanbanBoard = typeof kanbanBoards.$inferSelect
export type KanbanMilestone = typeof kanbanMilestones.$inferSelect
export type KanbanIssue = typeof kanbanIssues.$inferSelect
export type KanbanIssueComment = typeof kanbanIssueComments.$inferSelect
export type KanbanIssueRelation = typeof kanbanIssueRelations.$inferSelect

// ── Agent Sessions & Activities ───────────────────────────────────────────────

/** An agent session represents one delegation period on an issue. */
export const agentSessions = sqliteTable('agent_sessions', {
  id: textPk(),
  issueId: text('issue_id')
    .notNull()
    .references(() => kanbanIssues.id, { onDelete: 'cascade' }),
  agentProfileId: text('agent_profile_id')
    .notNull()
    .references(() => agentProfiles.id, { onDelete: 'restrict' }),
  /** Link to the underlying chat session used for agent execution. */
  chatSessionId: text('chat_session_id')
    .references(() => sessions.id, { onDelete: 'set null' }),
  status: text('status', {
    enum: ['created', 'active', 'completed', 'stopped', 'failed'],
  }).notNull().default('created'),
  ...timestamps(),
})

/** Immutable activity log for an agent session. Typed content, optional signals. */
export const agentActivities = sqliteTable('agent_activities', {
  id: textPk(),
  agentSessionId: text('agent_session_id')
    .notNull()
    .references(() => agentSessions.id, { onDelete: 'cascade' }),
  type: text('type', {
    enum: ['thought', 'action', 'response', 'elicitation', 'error', 'prompt'],
  }).notNull(),
  /** JSON content: { body } for most types; { action, parameter, result } for 'action'. */
  content: text('content').notNull(),
  /** Optional signal: 'stop', 'select', etc. */
  signal: text('signal'),
  /** Optional JSON metadata for the signal (e.g., select options). */
  signalMetadata: text('signal_metadata'),
  ...createdAt(),
})

export type AgentSession = typeof agentSessions.$inferSelect
export type NewAgentSession = typeof agentSessions.$inferInsert
export type AgentActivity = typeof agentActivities.$inferSelect
export type NewAgentActivity = typeof agentActivities.$inferInsert

// ── Agents (identity layer) ───────────────────────────────────────────────────

/** An Agent is a named AI identity bound to a Provider (agent_profiles) with its own avatar, model preference, and config. */
export const agents = sqliteTable('agents', {
  id: textPk(),
  name: text('name').notNull(),
  description: text('description'),
  /** DiceBear avatar URL, e.g. https://api.dicebear.com/9.x/{style}/svg?seed={seed} */
  avatarUrl: text('avatar_url'),
  /** DiceBear style name, e.g. 'bottts-neutral', 'thumbs', 'shapes' */
  avatarStyle: text('avatar_style').notNull().default('bottts-neutral'),
  /** Seed string for deterministic avatar generation */
  avatarSeed: text('avatar_seed').notNull(),
  /** FK → agent_profiles.id — the underlying provider connection */
  providerId: text('provider_id')
    .notNull()
    .references(() => agentProfiles.id, { onDelete: 'restrict' }),
  /** Selected model identifier from the provider's model list */
  modelId: text('model_id'),
  /** Thinking effort: 'low' | 'medium' | 'high' | 'auto' */
  thinkingEffort: text('thinking_effort', {
    enum: ['low', 'medium', 'high', 'auto'],
  }).notNull().default('auto'),
  /** Extensible JSON config (future: system prompt, tools, memory, etc.) */
  configJson: text('config_json').notNull().default('{}'),
  enabled: int('enabled', { mode: 'boolean' }).notNull().default(true),
  ...timestamps(),
})

export type Agent = typeof agents.$inferSelect
export type NewAgent = typeof agents.$inferInsert
