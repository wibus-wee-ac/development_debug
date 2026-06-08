import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const slackInstallations = sqliteTable('slack_installations', {
  teamId: text('team_id').primaryKey(),
  enterpriseId: text('enterprise_id'),
  botUserId: text('bot_user_id'),
  installedAt: integer('installed_at').notNull(),
  revokedAt: integer('revoked_at'),
})

export const workspaceBindings = sqliteTable('workspace_bindings', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull(),
  channelId: text('channel_id').notNull(),
  cradleWorkspaceId: text('cradle_workspace_id').notNull(),
  sessionAgentId: text('session_agent_id'),
  sessionProviderTargetId: text('session_provider_target_id'),
  sessionRuntimeKind: text('session_runtime_kind'),
  sessionModelId: text('session_model_id'),
  boundBySlackUserId: text('bound_by_slack_user_id').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => ({
  teamChannelUnique: uniqueIndex('workspace_bindings_team_channel_unique').on(table.teamId, table.channelId),
}))

export const actorBindings = sqliteTable('actor_bindings', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull(),
  slackUserId: text('slack_user_id').notNull(),
  cradleUserId: text('cradle_user_id').notNull(),
  createdAt: integer('created_at').notNull(),
  revokedAt: integer('revoked_at'),
}, table => ({
  teamUserUnique: uniqueIndex('actor_bindings_team_user_unique').on(table.teamId, table.slackUserId),
}))

export const threadBindings = sqliteTable('thread_bindings', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull(),
  channelId: text('channel_id').notNull(),
  threadTs: text('thread_ts').notNull(),
  cradleSessionId: text('cradle_session_id').notNull(),
  cradleWorkspaceId: text('cradle_workspace_id'),
  createdBySlackUserId: text('created_by_slack_user_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => ({
  teamChannelThreadUnique: uniqueIndex('thread_bindings_team_channel_thread_unique').on(table.teamId, table.channelId, table.threadTs),
  sessionIdx: index('thread_bindings_session_idx').on(table.cradleSessionId),
}))

export const inboundEvents = sqliteTable('inbound_events', {
  eventId: text('event_id').primaryKey(),
  teamId: text('team_id'),
  channelId: text('channel_id'),
  threadTs: text('thread_ts'),
  slackTs: text('slack_ts'),
  eventType: text('event_type').notNull(),
  status: text('status').notNull(),
  reason: text('reason'),
  receivedAt: integer('received_at').notNull(),
  processedAt: integer('processed_at'),
}, table => ({
  statusIdx: index('inbound_events_status_idx').on(table.status),
}))

export const deliveryAttempts = sqliteTable('delivery_attempts', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull(),
  channelId: text('channel_id').notNull(),
  threadTs: text('thread_ts').notNull(),
  cradleSessionId: text('cradle_session_id').notNull(),
  cradleMessageId: text('cradle_message_id'),
  runId: text('run_id'),
  messageText: text('message_text'),
  messageBlocksJson: text('message_blocks_json'),
  status: text('status').notNull(),
  attemptCount: integer('attempt_count').notNull(),
  slackTs: text('slack_ts'),
  errorText: text('error_text'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => ({
  statusIdx: index('delivery_attempts_status_idx').on(table.status),
  threadIdx: index('delivery_attempts_thread_idx').on(table.teamId, table.channelId, table.threadTs),
}))

export type SlackInstallation = typeof slackInstallations.$inferSelect
export type WorkspaceBinding = typeof workspaceBindings.$inferSelect
export type ThreadBinding = typeof threadBindings.$inferSelect
export type InboundEvent = typeof inboundEvents.$inferSelect
export type DeliveryAttempt = typeof deliveryAttempts.$inferSelect
