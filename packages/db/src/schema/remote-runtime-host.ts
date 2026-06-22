import { index, int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { sessions } from './chat'
import { textPk, timestamps } from './shared'

export const remoteRuntimeHosts = sqliteTable(
  'remote_runtime_hosts',
  {
    id: textPk(),
    displayName: text('display_name').notNull(),
    sshTarget: text('ssh_target').notNull(),
    remoteSocketPath: text('remote_socket_path').notNull(),
    enabled: int('enabled', { mode: 'boolean' }).notNull().default(true),
    lastDaemonHostId: text('last_daemon_host_id'),
    lastDaemonVersion: text('last_daemon_version'),
    lastPlatform: text('last_platform'),
    lastArch: text('last_arch'),
    lastSeenAt: int('last_seen_at'),
    connectionConfigJson: text('connection_config_json').notNull().default('{}'),
    ...timestamps(),
  },
  table => ({
    bySshTarget: index('remote_runtime_hosts_ssh_target_idx').on(table.sshTarget),
    byEnabled: index('remote_runtime_hosts_enabled_idx').on(table.enabled),
  }),
)

export const remoteRuntimeSessionLinks = sqliteTable(
  'remote_runtime_session_links',
  {
    id: textPk(),
    chatSessionId: text('chat_session_id')
      .notNull()
      .unique()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    remoteHostId: text('remote_host_id')
      .notNull()
      .references(() => remoteRuntimeHosts.id, { onDelete: 'cascade' }),
    remoteAgentId: text('remote_agent_id').notNull(),
    remoteRuntimeKind: text('remote_runtime_kind').notNull(),
    daemonHostId: text('daemon_host_id'),
    providerSessionId: text('provider_session_id'),
    stateSnapshotJson: text('state_snapshot_json').notNull().default('{}'),
    ...timestamps(),
  },
  table => ({
    byRemoteHost: index('remote_runtime_session_links_host_idx').on(table.remoteHostId),
    byRemoteAgent: index('remote_runtime_session_links_agent_idx').on(table.remoteAgentId),
  }),
)

export type RemoteRuntimeHost = typeof remoteRuntimeHosts.$inferSelect
export type NewRemoteRuntimeHost = typeof remoteRuntimeHosts.$inferInsert
export type RemoteRuntimeSessionLink = typeof remoteRuntimeSessionLinks.$inferSelect
export type NewRemoteRuntimeSessionLink = typeof remoteRuntimeSessionLinks.$inferInsert
