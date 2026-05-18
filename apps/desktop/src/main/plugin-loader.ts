import { resolve } from 'node:path'
import { app } from 'electron'
import type { PluginManifest, Disposable } from '@cradle/plugin-sdk'
import type { DesktopPluginContext } from '@cradle/plugin-sdk/desktop'
import { discoverPlugins } from './plugin-discovery'

/** Shared config written by desktop plugins, consumed as env vars by server */
const pluginSharedConfig = new Map<string, string>()

/** Active plugin deactivators */
const activePlugins = new Map<string, { deactivate?: () => void | Promise<void> }>()

/** Webview creation listeners from plugins */
const webviewListeners: Array<(wc: Electron.WebContents, tabId: string) => void> = []

/** Get plugin env vars to pass to the forked server process */
export function getPluginEnvVars(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of pluginSharedConfig) {
    env[`CRADLE_PLUGIN_${key.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`] = value
  }
  return env
}

/** Notify all desktop plugins about a new webview */
export function notifyWebviewCreated(wc: Electron.WebContents, tabId: string): void {
  for (const listener of webviewListeners) {
    try {
      listener(wc, tabId)
    } catch (err) {
      console.error('[plugin-loader] webview listener error:', err)
    }
  }
}

function createDesktopPluginContext(manifest: PluginManifest): DesktopPluginContext {
  const logger = {
    info: (msg: string, ...args: unknown[]) => console.log(`[plugin:${manifest.name}]`, msg, ...args),
    warn: (msg: string, ...args: unknown[]) => console.warn(`[plugin:${manifest.name}]`, msg, ...args),
    error: (msg: string, ...args: unknown[]) => console.error(`[plugin:${manifest.name}]`, msg, ...args),
    debug: (msg: string, ...args: unknown[]) => console.debug(`[plugin:${manifest.name}]`, msg, ...args),
  }

  return {
    userDataPath: app.getPath('userData'),
    onWebviewCreated(handler: (wc: unknown, tabId: string) => void): Disposable {
      webviewListeners.push(handler as (wc: Electron.WebContents, tabId: string) => void)
      return {
        dispose() {
          const idx = webviewListeners.indexOf(handler as any)
          if (idx >= 0) webviewListeners.splice(idx, 1)
        },
      }
    },
    setSharedConfig(key: string, value: string) {
      pluginSharedConfig.set(key, value)
    },
    logger,
    manifest,
  }
}

function validatePluginModule(
  mod: unknown,
  pluginName: string,
): asserts mod is { activate: Function; deactivate?: Function } {
  if (mod === null || typeof mod !== 'object') {
    throw new Error(`[plugin:${pluginName}] desktop entry did not export a module object`)
  }
  const m = mod as Record<string, unknown>
  if (typeof m.activate !== 'function') {
    throw new Error(`[plugin:${pluginName}] desktop entry does not export 'activate' function`)
  }
}

/**
 * Discover and activate all desktop plugins.
 * Must be called BEFORE startServer() so shared config is available for the fork.
 */
export async function activateDesktopPlugins(): Promise<void> {
  const isDev = !!process.env.ELECTRON_RENDERER_URL
  const pluginsDir = isDev
    ? resolve(__dirname, '../../../../plugins')
    : resolve(process.resourcesPath!, 'plugins')

  const manifests = await discoverPlugins(pluginsDir)
  const desktopPlugins = manifests.filter(m => m.cradle.desktop)

  for (const manifest of desktopPlugins) {
    const entryPath = resolve(manifest.packageDir, manifest.cradle.desktop!)
    try {
      const mod = await import(entryPath)
      validatePluginModule(mod, manifest.name)

      const ctx = createDesktopPluginContext(manifest)
      await mod.activate(ctx)

      activePlugins.set(manifest.name, { deactivate: mod.deactivate as (() => void | Promise<void>) | undefined })
      console.log(`[plugins] desktop activated: ${manifest.name}`)
    } catch (err) {
      console.error(`[plugins] failed to activate desktop plugin ${manifest.name}:`, err)
    }
  }
}

/** Deactivate all desktop plugins (called on app quit) */
export async function deactivateDesktopPlugins(): Promise<void> {
  for (const [name, plugin] of activePlugins) {
    try {
      await plugin.deactivate?.()
    } catch (err) {
      console.error(`[plugins] error deactivating ${name}:`, err)
    }
  }
  activePlugins.clear()
}
