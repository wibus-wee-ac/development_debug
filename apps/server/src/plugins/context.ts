import type { PluginManifest } from '@cradle/plugin-sdk'
import type { ServerPluginContext } from '@cradle/plugin-sdk/server'
import { createChildLogger } from '../logging/logger'
import { createPluginEventBus } from './event-bus'
import { registerExternalProviderSource } from './external-provider-source-registry'
import { registerOwnedAfterResponseHook, registerOwnedBeforeQueryHook } from './hooks'
import { registerPluginMcpServer } from './mcp-registry'
import { registerOwnedPluginSkill } from './skill-registry'
import { createPluginStorage } from './storage'

export function createServerPluginContext(
  manifest: PluginManifest,
  app: unknown,
): ServerPluginContext {
  const pluginLogger = createChildLogger({ module: 'plugin', plugin: manifest.name })
  const logger = {
    info: (msg: string, ...args: unknown[]) => pluginLogger.info(msg, { args }),
    warn: (msg: string, ...args: unknown[]) => pluginLogger.warn(msg, { args }),
    error: (msg: string, ...args: unknown[]) => pluginLogger.error(msg, { args }),
    debug: (msg: string, ...args: unknown[]) => pluginLogger.debug(msg, { args }),
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
      registerPluginMcpServer(manifest.name, config)
    },
    registerSkill(skill) {
      registerOwnedPluginSkill(manifest.name, skill)
    },
    externalProviderSources: {
      register(source) {
        return registerExternalProviderSource(manifest.name, source)
      },
    },
    storage: createPluginStorage(manifest.name),
    logger,
    sharedConfig,
    manifest,
    hooks: {
      onBeforeQuery(handler) {
        return registerOwnedBeforeQueryHook(manifest.name, handler)
      },
      onAfterResponse(handler) {
        return registerOwnedAfterResponseHook(manifest.name, handler)
      },
    },
    events: eventBus,
  }
}
