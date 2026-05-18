import type { PluginManifest } from '@cradle/plugin-sdk'
import type { ServerPluginContext } from '@cradle/plugin-sdk/server'
import { createPluginEventBus } from './event-bus'
import { registerAfterResponseHook, registerBeforeQueryHook } from './hooks'
import { registerMcpServer } from './mcp-registry'
import { registerPluginSkill } from './skill-registry'
import { createPluginStorage } from './storage'

export function createServerPluginContext(
  manifest: PluginManifest,
  app: unknown,
): ServerPluginContext {
  const logger = {
    info: (msg: string, ...args: unknown[]) => console.log(`[plugin:${manifest.name}]`, msg, ...args),
    warn: (msg: string, ...args: unknown[]) => console.warn(`[plugin:${manifest.name}]`, msg, ...args),
    error: (msg: string, ...args: unknown[]) => console.error(`[plugin:${manifest.name}]`, msg, ...args),
    debug: (msg: string, ...args: unknown[]) => console.debug(`[plugin:${manifest.name}]`, msg, ...args),
  }

  // Build shared config from env vars (CRADLE_PLUGIN_* prefix)
  const sharedConfig = new Map<string, string>()
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CRADLE_PLUGIN_') && value !== undefined) {
      sharedConfig.set(key.replace('CRADLE_PLUGIN_', ''), value)
    }
  }

  const eventBus = createPluginEventBus()

  return {
    app,
    registerMcpServer(config) {
      if (config.when && !config.when()) {
        logger.debug(`MCP server ${config.name} skipped — when() returned false`)
        return
      }
      registerMcpServer(config)
    },
    registerSkill: registerPluginSkill,
    storage: createPluginStorage(manifest.name),
    logger,
    sharedConfig,
    manifest,
    hooks: {
      onBeforeQuery: registerBeforeQueryHook,
      onAfterResponse: registerAfterResponseHook,
    },
    events: eventBus,
  }
}
