// Input: shared schema helpers and sqlite column builders
// Output: ACP registry/install tables plus inferred row types
// Position: ACP-specific persistence schema module used by ACP installers and audits

import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createdAt, timestamps } from './shared'

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

export type AcpAgent = typeof acpAgents.$inferSelect
export type AcpAuditEntry = typeof acpAuditLog.$inferSelect
