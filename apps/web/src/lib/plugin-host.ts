import type { WebPlugin, WebPluginContext, WebPluginStorage } from '@cradle/plugin-sdk/web'
import { derivePluginRouteSegment, type PluginDescriptor } from '@cradle/plugin-sdk'
import { getServerUrl } from './electron'
import { usePluginStore } from './plugin-store'

type WebPluginDescriptor = Pick<PluginDescriptor, 'name' | 'version' | 'displayName' | 'hasWeb'>
  & Partial<Pick<PluginDescriptor, 'identity' | 'routeSegment'>>

function createWebPluginStorage(pluginName: string): WebPluginStorage {
  const prefix = `cradle-plugin:${pluginName}:`
  return {
    get(key: string) {
      return localStorage.getItem(prefix + key)
    },
    set(key: string, value: string) {
      localStorage.setItem(prefix + key, value)
    },
    delete(key: string) {
      localStorage.removeItem(prefix + key)
    },
  }
}

function createWebPluginContext(pluginName: string): WebPluginContext {
  const store = usePluginStore.getState()
  const logger = {
    info: (msg: string, ...args: unknown[]) => console.log(`[plugin:${pluginName}]`, msg, ...args),
    warn: (msg: string, ...args: unknown[]) => console.warn(`[plugin:${pluginName}]`, msg, ...args),
    error: (msg: string, ...args: unknown[]) => console.error(`[plugin:${pluginName}]`, msg, ...args),
    debug: (msg: string, ...args: unknown[]) => console.debug(`[plugin:${pluginName}]`, msg, ...args),
  }

  return {
    registerPanel(panel) {
      const dispose = store.registerPanel(pluginName, panel)
      return { dispose }
    },
    registerCommand(cmd) {
      const dispose = store.registerCommand(pluginName, cmd)
      return { dispose }
    },
    storage: createWebPluginStorage(pluginName),
    logger,
  }
}

function getWebBundleRouteSegment(plugin: WebPluginDescriptor): string {
  return plugin.routeSegment ?? derivePluginRouteSegment(plugin.identity ?? plugin.name)
}

/**
 * Load and activate all web plugins.
 * Called once at app initialization, before React renders.
 */
export async function loadWebPlugins(): Promise<void> {
  try {
    // Fetch plugin list from server
    const baseUrl = getServerUrl()
    const response = await fetch(`${baseUrl}/api/plugins`)
    if (!response.ok) {
      console.warn('[plugin-host] Failed to fetch plugin list:', response.status)
      return
    }

    const plugins: WebPluginDescriptor[] = await response.json()
    const webPlugins = plugins.filter((p) => p.hasWeb)

    if (webPlugins.length === 0) return

    // Load each web plugin
    const results = await Promise.allSettled(
      webPlugins.map(async (plugin) => {
        const owner = plugin.identity ?? plugin.name
        const moduleUrl = `${baseUrl}/api/plugins/${getWebBundleRouteSegment(plugin)}/web.mjs`
        const mod = await import(/* @vite-ignore */ moduleUrl)

        const activateFn = mod.activate ?? mod.default?.activate
        if (typeof activateFn !== 'function') {
          throw new Error(`Plugin ${owner} web entry does not export 'activate'`)
        }

        const ctx = createWebPluginContext(owner)
        await activateFn(ctx)
        console.log(`[plugin-host] activated: ${owner}`)
      }),
    )

    // Log failures
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        const reason = (results[i] as PromiseRejectedResult).reason
        const msg = reason instanceof Error ? reason.message : String(reason)
        console.error(`[plugin-host] failed to load ${webPlugins[i].name}:`, msg, reason)
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[plugin-host] Plugin loading failed:', msg, err)
  }
}
