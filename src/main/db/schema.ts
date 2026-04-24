// Input: drizzle-orm sqlite schema builders
// Output: SQLite table definitions and inferred row types for workspaces, chat sessions, ACP agents, audit log, CLI agents, and Kanban entities
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
  agent: text('agent').notNull().default('claude'),
  /**
   * Last attached ACP agent session ID.
   * Used as the recovery handle across restarts; may be offline until `ensureLive()` reattaches it.
   */
  recoverableAcpSessionId: text('recoverable_acp_session_id'),
  /** Model ID snapshot captured at session creation. Shown when no active ACP session. */
  modelId: text('model_id'),
  /** JSON array of SessionConfigOption snapshots captured at creation. */
  configSnapshot: text('config_snapshot'),
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

/**
 * Installed ACP agents. Tracks both binary (file on disk) and
 * package-manager agents (npx / uvx — no binary written).
 */
export const acpAgents = sqliteTable('acp_agents', {
  id: text('id').primaryKey(), // registry id, e.g. "claude-acp"
  name: text('name').notNull(),
  version: text('version').notNull(),
  /** 'binary' | 'npx' | 'uvx' */
  distributionType: text('distribution_type').notNull(),
  /** Absolute path to the extracted directory (binary only, else null). */
  installPath: text('install_path'),
  /** Relative cmd inside installPath (binary) or package name (npx/uvx). */
  cmd: text('cmd'),
  /** JSON array of extra CLI args. */
  args: text('args').notNull().default('[]'),
  /** JSON object of extra env vars. */
  env: text('env').notNull().default('{}'),
  /** 'installing' | 'installed' | 'failed' | 'uninstalling' */
  status: text('status').notNull().default('installing'),
  ...timestamps(),
})

/**
 * Immutable audit log for every file-system write/delete performed by the
 * ACP installer. Entries are append-only so the full history is replayable.
 */
export const acpAuditLog = sqliteTable('acp_audit_log', {
  id: int('id').primaryKey({ autoIncrement: true }),
  agentId: text('agent_id').notNull(),
  /**
   * 'install_start' | 'file_download' | 'file_extract' | 'file_chmod'
   * | 'install_complete' | 'install_failed'
   * | 'uninstall_start' | 'file_delete' | 'uninstall_complete'
   */
  action: text('action').notNull(),
  /** Absolute path involved in the operation (may be null for logical events). */
  path: text('path'),
  /** JSON blob with extra context (URL, error message, …). */
  details: text('details').notNull().default('{}'),
  ...createdAt(),
})

/**
 * CLI agents — system-installed CLI tools (e.g. `claude`, `codex`) that the
 * user has configured for use in terminal sessions.
 */
export const cliAgents = sqliteTable('cli_agents', {
  id: text('id').primaryKey(), // user-supplied, e.g. "claude-code"
  name: text('name').notNull(),
  /** Absolute path or bare executable name (resolved via PATH at PTY start). */
  executable: text('executable').notNull(),
  /** JSON array of extra CLI args prepended on start. */
  args: text('args').notNull().default('[]'),
  ...timestamps(),
})

// ── Inferred types ────────────────────────────────────────────────────────────

export type Workspace = typeof workspaces.$inferSelect
export type NewWorkspace = typeof workspaces.$inferInsert
export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
export type AcpAgent = typeof acpAgents.$inferSelect
export type NewAcpAgent = typeof acpAgents.$inferInsert
export type AcpAuditEntry = typeof acpAuditLog.$inferSelect
export type CliAgent = typeof cliAgents.$inferSelect
export type NewCliAgent = typeof cliAgents.$inferInsert

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
