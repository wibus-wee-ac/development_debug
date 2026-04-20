// Input: drizzle-orm sqlite schema builders
// Output: SQLite table definitions and inferred row types for workspaces, chat sessions, ACP agents, and audit log
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
