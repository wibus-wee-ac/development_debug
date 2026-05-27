import { index, int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { textPk, timestamps } from './shared'

export const externalProviderSources = sqliteTable('external_provider_sources', {
  id: textPk(),
  pluginName: text('plugin_name').notNull(),
  sourceId: text('source_id').notNull(),
  label: text('label').notNull(),
  description: text('description'),
  enabled: int('enabled', { mode: 'boolean' }).notNull().default(true),
  capabilitiesJson: text('capabilities_json').notNull().default('{}'),
  inventoryJson: text('inventory_json').notNull().default('{}'),
  warningsJson: text('warnings_json').notNull().default('[]'),
  lastSyncStatus: text('last_sync_status', {
    enum: ['never', 'ok', 'warning', 'error'],
  }).notNull().default('never'),
  lastSyncMessage: text('last_sync_message'),
  lastSyncError: text('last_sync_error'),
  lastSyncAt: int('last_sync_at'),
  ...timestamps(),
}, table => ({
  byPluginSource: uniqueIndex('external_provider_sources_plugin_source_unique').on(table.pluginName, table.sourceId),
}))

export const externalProviderRecords = sqliteTable('external_provider_records', {
  id: textPk(),
  sourceKey: text('source_key').notNull(),
  externalId: text('external_id').notNull(),
  app: text('app').notNull(),
  name: text('name').notNull(),
  providerKind: text('provider_kind', {
    enum: ['openai-compatible', 'anthropic'],
  }).notNull(),
  status: text('status', {
    enum: ['active', 'stale', 'missing', 'unsupported', 'error'],
  }).notNull().default('active'),
  fingerprint: text('fingerprint').notNull(),
  metadataJson: text('metadata_json').notNull().default('{}'),
  warningsJson: text('warnings_json').notNull().default('[]'),
  lastSeenAt: int('last_seen_at').notNull(),
  ...timestamps(),
}, table => ({
  bySourceExternal: uniqueIndex('external_provider_records_source_external_unique').on(table.sourceKey, table.externalId),
  bySource: index('external_provider_records_source_idx').on(table.sourceKey),
  byStatus: index('external_provider_records_status_idx').on(table.status),
}))

export type ExternalProviderSource = typeof externalProviderSources.$inferSelect
export type NewExternalProviderSource = typeof externalProviderSources.$inferInsert
export type ExternalProviderRecord = typeof externalProviderRecords.$inferSelect
export type NewExternalProviderRecord = typeof externalProviderRecords.$inferInsert

export const externalProviderRuntimeTargets = sqliteTable('external_provider_runtime_targets', {
  id: textPk(),
  sourceKey: text('source_key').notNull(),
  externalRecordId: text('external_record_id').notNull(),
  providerKind: text('provider_kind', {
    enum: ['openai-compatible', 'anthropic'],
  }).notNull(),
  displayName: text('display_name').notNull(),
  enabled: int('enabled', { mode: 'boolean' }).notNull().default(true),
  configJson: text('config_json').notNull().default('{}'),
  credentialRef: text('credential_ref'),
  customModelsJson: text('custom_models_json').notNull().default('[]'),
  iconSlug: text('icon_slug'),
  lastResolvedFingerprint: text('last_resolved_fingerprint').notNull(),
  ...timestamps(),
}, table => ({
  bySourceRecord: uniqueIndex('external_provider_runtime_targets_source_record_unique')
    .on(table.sourceKey, table.externalRecordId),
  byEnabled: index('external_provider_runtime_targets_enabled_idx').on(table.enabled),
}))

export type ExternalProviderRuntimeTarget = typeof externalProviderRuntimeTargets.$inferSelect
export type NewExternalProviderRuntimeTarget = typeof externalProviderRuntimeTargets.$inferInsert
