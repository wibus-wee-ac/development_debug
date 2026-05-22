/* Defines Cradle-owned persistent storage for plugin server contexts. */
import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { textPk, timestamps } from './shared'

export const pluginStorageEntries = sqliteTable('plugin_storage_entries', {
  id: textPk(),
  pluginName: text('plugin_name').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  ...timestamps(),
}, table => ({
  byPluginKey: uniqueIndex('plugin_storage_entries_plugin_key_unique').on(table.pluginName, table.key),
  byPlugin: index('plugin_storage_entries_plugin_idx').on(table.pluginName),
}))

export type PluginStorageEntry = typeof pluginStorageEntries.$inferSelect
export type NewPluginStorageEntry = typeof pluginStorageEntries.$inferInsert
