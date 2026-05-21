import { index, int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { textPk, timestamps, workspaces } from './shared'

export const chronicleSnapshots = sqliteTable('chronicle_snapshots', {
  id: textPk(),
  sourceId: text('source_id').notNull(),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'set null' }),
  capturedAt: int('captured_at').notNull(),
  displayId: int('display_id').notNull().default(0),
  segmentDir: text('segment_dir').notNull().default(''),
  framePath: text('frame_path').notNull().default(''),
  artifactPath: text('artifact_path'),
  ocrText: text('ocr_text'),
  appBundleId: text('app_bundle_id'),
  windowTitle: text('window_title'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  ...timestamps(),
}, table => ({
  bySourceId: uniqueIndex('chronicle_snapshots_source_id_unique').on(table.sourceId),
  byCapturedAt: index('chronicle_snapshots_captured_at_idx').on(table.capturedAt),
  byWorkspaceCapturedAt: index('chronicle_snapshots_workspace_captured_at_idx').on(table.workspaceId, table.capturedAt),
}))

export const chronicleMemories = sqliteTable('chronicle_memories', {
  id: textPk(),
  sourceId: text('source_id').notNull(),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'set null' }),
  type: text('type', { enum: ['10min', '6h'] }).notNull(),
  source: text('source', { enum: ['llm', 'local', 'imported'] }).notNull().default('llm'),
  content: text('content').notNull(),
  prompt: text('prompt'),
  sourceSnapshotIdsJson: text('source_snapshot_ids_json').notNull().default('[]'),
  sourcePathsJson: text('source_paths_json').notNull().default('[]'),
  modelProfileId: text('model_profile_id'),
  modelId: text('model_id'),
  usageJson: text('usage_json').notNull().default('{}'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  createdAt: int('created_at').notNull(),
  updatedAt: int('updated_at').notNull(),
}, table => ({
  bySourceId: uniqueIndex('chronicle_memories_source_id_unique').on(table.sourceId),
  byCreatedAt: index('chronicle_memories_created_at_idx').on(table.createdAt),
  byWorkspaceCreatedAt: index('chronicle_memories_workspace_created_at_idx').on(table.workspaceId, table.createdAt),
  byTypeCreatedAt: index('chronicle_memories_type_created_at_idx').on(table.type, table.createdAt),
}))

export const chronicleModelResources = sqliteTable('chronicle_model_resources', {
  id: textPk(),
  category: text('category', {
    enum: ['ocr', 'audio-vad', 'audio-asr', 'speaker', 'embedding'],
  }).notNull(),
  status: text('status', {
    enum: ['available', 'missing', 'installing', 'installed', 'error'],
  }).notNull().default('missing'),
  displayName: text('display_name').notNull(),
  path: text('path'),
  version: text('version'),
  message: text('message'),
  sizeBytes: int('size_bytes'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  ...timestamps(),
}, table => ({
  byCategory: uniqueIndex('chronicle_model_resources_category_unique').on(table.category),
  byStatus: index('chronicle_model_resources_status_idx').on(table.status),
}))

export const chronicleMessageSources = sqliteTable('chronicle_message_sources', {
  id: textPk(),
  platform: text('platform', { enum: ['slack'] }).notNull(),
  label: text('label').notNull(),
  enabled: int('enabled', { mode: 'boolean' }).notNull().default(true),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'set null' }),
  teamId: text('team_id'),
  botTokenRef: text('bot_token_ref'),
  channelIdsJson: text('channel_ids_json').notNull().default('[]'),
  configJson: text('config_json').notNull().default('{}'),
  status: text('status', {
    enum: ['idle', 'syncing', 'ready', 'error', 'disabled'],
  }).notNull().default('idle'),
  lastSyncAt: int('last_sync_at'),
  lastMessageAt: int('last_message_at'),
  lastError: text('last_error'),
  ...timestamps(),
}, table => ({
  byPlatformEnabled: index('chronicle_message_sources_platform_enabled_idx').on(table.platform, table.enabled),
  byWorkspace: index('chronicle_message_sources_workspace_id_idx').on(table.workspaceId),
}))

export const chronicleMessages = sqliteTable('chronicle_messages', {
  id: textPk(),
  sourceId: text('source_id')
    .notNull()
    .references(() => chronicleMessageSources.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'set null' }),
  platform: text('platform', { enum: ['slack'] }).notNull(),
  externalMessageId: text('external_message_id').notNull(),
  teamId: text('team_id'),
  channelId: text('channel_id').notNull(),
  channelName: text('channel_name'),
  threadId: text('thread_id'),
  userId: text('user_id'),
  userName: text('user_name'),
  text: text('text').notNull().default(''),
  isDm: int('is_dm', { mode: 'boolean' }).notNull().default(false),
  messageTs: text('message_ts').notNull(),
  messageAt: int('message_at').notNull(),
  permalink: text('permalink'),
  attachmentsJson: text('attachments_json').notNull().default('[]'),
  rawJson: text('raw_json').notNull().default('{}'),
  dedupHash: text('dedup_hash').notNull(),
  ...timestamps(),
}, table => ({
  byExternalMessage: uniqueIndex('chronicle_messages_source_external_unique').on(table.sourceId, table.externalMessageId),
  bySourceMessageAt: index('chronicle_messages_source_message_at_idx').on(table.sourceId, table.messageAt),
  byWorkspaceMessageAt: index('chronicle_messages_workspace_message_at_idx').on(table.workspaceId, table.messageAt),
  byDedupHash: index('chronicle_messages_dedup_hash_idx').on(table.dedupHash),
}))

export const chronicleEvents = sqliteTable('chronicle_events', {
  id: textPk(),
  type: text('type', {
    enum: ['config', 'daemon', 'snapshot', 'memory', 'summarize', 'model-resource', 'message'],
  }).notNull(),
  status: text('status', {
    enum: ['info', 'success', 'warning', 'error'],
  }).notNull().default('info'),
  message: text('message').notNull(),
  snapshotId: text('snapshot_id')
    .references(() => chronicleSnapshots.id, { onDelete: 'set null' }),
  memoryId: text('memory_id')
    .references(() => chronicleMemories.id, { onDelete: 'set null' }),
  attrsJson: text('attrs_json').notNull().default('{}'),
  createdAt: int('created_at').notNull(),
}, table => ({
  byCreatedAt: index('chronicle_events_created_at_idx').on(table.createdAt),
  byTypeCreatedAt: index('chronicle_events_type_created_at_idx').on(table.type, table.createdAt),
  bySnapshot: index('chronicle_events_snapshot_id_idx').on(table.snapshotId),
  byMemory: index('chronicle_events_memory_id_idx').on(table.memoryId),
}))

export type ChronicleSnapshot = typeof chronicleSnapshots.$inferSelect
export type NewChronicleSnapshot = typeof chronicleSnapshots.$inferInsert
export type ChronicleMemory = typeof chronicleMemories.$inferSelect
export type NewChronicleMemory = typeof chronicleMemories.$inferInsert
export type ChronicleModelResource = typeof chronicleModelResources.$inferSelect
export type NewChronicleModelResource = typeof chronicleModelResources.$inferInsert
export type ChronicleMessageSource = typeof chronicleMessageSources.$inferSelect
export type NewChronicleMessageSource = typeof chronicleMessageSources.$inferInsert
export type ChronicleMessage = typeof chronicleMessages.$inferSelect
export type NewChronicleMessage = typeof chronicleMessages.$inferInsert
export type ChronicleEvent = typeof chronicleEvents.$inferSelect
export type NewChronicleEvent = typeof chronicleEvents.$inferInsert
