import type { PluginStorage } from '@cradle/plugin-sdk/server'

// Uses the existing db infrastructure. For now, simple in-memory with file persistence.
// TODO: Use Drizzle ORM when plugin_storage table is added to schema.

const memoryStore = new Map<string, Map<string, string>>()

export function createPluginStorage(pluginName: string): PluginStorage {
  if (!memoryStore.has(pluginName)) {
    memoryStore.set(pluginName, new Map())
  }
  const store = memoryStore.get(pluginName)!

  return {
    async get(key: string) {
      return store.get(key) ?? null
    },
    async set(key: string, value: string) {
      store.set(key, value)
    },
    async delete(key: string) {
      store.delete(key)
    },
  }
}
