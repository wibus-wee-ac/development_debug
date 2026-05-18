import { delimiter, resolve } from 'node:path'
import { app, BrowserWindow } from 'electron'
import type { Disposable, PluginCapabilityRecord, PluginDescriptor, PluginManifest } from '@cradle/plugin-sdk'
import type { DesktopPluginContext } from '@cradle/plugin-sdk/desktop'
import { discoverDesktopPlugins, type DesktopPluginSource } from './plugin-discovery'

/** Shared config written by desktop plugins, consumed as env vars by server */
const pluginSharedConfig = new Map<string, string>()

/** Active plugin deactivators */
const activePlugins = new Map<string, { deactivate?: () => void | Promise<void> }>()

/** Webview creation listeners from plugins */
const webviewListeners: Array<(wc: Electron.WebContents, tabId: string) => void> = []

/** Governed desktop plugin projection */
const desktopPluginDescriptors = new Map<string, PluginDescriptor>()
const invalidDesktopPluginDescriptors: PluginDescriptor[] = []

let capabilitySequence = 0

function cloneDescriptor(descriptor: PluginDescriptor): PluginDescriptor {
  return {
    ...descriptor,
    source: { ...descriptor.source },
    layers: {
      server: { ...descriptor.layers.server },
      web: { ...descriptor.layers.web },
      desktop: { ...descriptor.layers.desktop },
    },
    capabilities: descriptor.capabilities.map(capability => ({
      ...capability,
      metadata: capability.metadata ? { ...capability.metadata } : undefined,
    })),
    warnings: [...descriptor.warnings],
  }
}

/** Get the desktop-side governed plugin projection. */
export function getDesktopPluginDescriptors(): PluginDescriptor[] {
  return [
    ...invalidDesktopPluginDescriptors.map(cloneDescriptor),
    ...Array.from(desktopPluginDescriptors.values(), cloneDescriptor),
  ]
}

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

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function setDesktopLayerStatus(
  descriptor: PluginDescriptor,
  status: PluginDescriptor['layers']['desktop']['status'],
  error?: string,
): void {
  descriptor.layers.desktop = {
    ...descriptor.layers.desktop,
    status,
    error,
    activatedAt: status === 'active' ? new Date().toISOString() : descriptor.layers.desktop.activatedAt,
  }
}

function addCapabilityRecord(descriptor: PluginDescriptor, record: PluginCapabilityRecord): void {
  descriptor.capabilities.push(record)
}

function removeCapabilityRecord(descriptor: PluginDescriptor, capabilityId: string): void {
  const index = descriptor.capabilities.findIndex(capability => capability.id === capabilityId)
  if (index >= 0) {
    descriptor.capabilities.splice(index, 1)
  }
}

function createCapabilityId(owner: string, capabilityName: string): string {
  capabilitySequence += 1
  return `${owner}:${capabilityName}:${capabilitySequence}`
}

function isRejectedDescriptor(descriptor: PluginDescriptor): boolean {
  return descriptor.layers.desktop.status === 'invalid'
    || descriptor.layers.server.status === 'invalid'
    || descriptor.layers.web.status === 'invalid'
}

function createDesktopPluginSources(isDev: boolean): DesktopPluginSource[] {
  const defaultSource: DesktopPluginSource = isDev
    ? {
        pluginsDir: resolve(__dirname, '../../../../plugins'),
        kind: 'workspaceDev',
        trusted: true,
        reason: 'Workspace plugin directory used by the Electron development runtime',
      }
    : {
        pluginsDir: resolve(process.resourcesPath!, 'plugins'),
        kind: 'bundledResource',
        trusted: true,
        reason: 'Bundled plugin resource directory shipped with the desktop app',
      }

  const externalDirs = [
    process.env.CRADLE_DESKTOP_EXTERNAL_PLUGIN_DIRS,
    process.env.CRADLE_EXTERNAL_PLUGINS_DIRS,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .flatMap(value => value.split(delimiter))
    .map(value => value.trim())
    .filter(Boolean)

  const externalSources = externalDirs.map<DesktopPluginSource>(pluginsDir => ({
    pluginsDir,
    kind: 'externalLocal',
    trusted: true,
    reason: 'Operator-configured trusted local plugin directory; no sandbox isolation is implied',
  }))

  return [defaultSource, ...externalSources]
}

function createDesktopPluginContext(manifest: PluginManifest): DesktopPluginContext {
  const descriptor = desktopPluginDescriptors.get(manifest.name)
  const logger = {
    info: (msg: string, ...args: unknown[]) => console.log(`[plugin:${manifest.name}]`, msg, ...args),
    warn: (msg: string, ...args: unknown[]) => console.warn(`[plugin:${manifest.name}]`, msg, ...args),
    error: (msg: string, ...args: unknown[]) => console.error(`[plugin:${manifest.name}]`, msg, ...args),
    debug: (msg: string, ...args: unknown[]) => console.debug(`[plugin:${manifest.name}]`, msg, ...args),
  }

  return {
    userDataPath: app.getPath('userData'),
    onWebviewCreated(handler: (wc: unknown, tabId: string) => void): Disposable {
      const listener = handler as (wc: Electron.WebContents, tabId: string) => void
      webviewListeners.push(listener)
      const capabilityId = createCapabilityId(manifest.name, 'desktop.webview-listener')
      if (descriptor) {
        addCapabilityRecord(descriptor, {
          id: capabilityId,
          owner: manifest.name,
          type: 'desktop.webviewListener',
          layer: 'desktop',
          status: 'registered',
          label: 'Webview creation listener',
        })
      }
      return {
        dispose() {
          const idx = webviewListeners.indexOf(listener)
          if (idx >= 0) webviewListeners.splice(idx, 1)
          if (descriptor) {
            removeCapabilityRecord(descriptor, capabilityId)
          }
        },
      }
    },
    async requestBrowserTab(url?: string): Promise<void> {
      const window = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL().includes('/#/chat/'))
        ?? BrowserWindow.getFocusedWindow()
        ?? BrowserWindow.getAllWindows().find(w => !w.isDestroyed())
      if (!window) {
        throw new Error('No renderer window available for browser tab creation')
      }
      const handled = await window.webContents.executeJavaScript(
        `(() => {
          if (typeof globalThis.__cradleBrowserUseCreateTab !== 'function') return false;
          globalThis.__cradleBrowserUseCreateTab(${JSON.stringify(url)});
          return true;
        })()`,
        true,
      )
      if (!handled) {
        window.webContents.send('browser-use:create-tab', { url })
      }
    },
    setSharedConfig(key: string, value: string) {
      pluginSharedConfig.set(key, value)
      if (descriptor) {
        const capabilityId = `${manifest.name}:desktop.shared-config:${key}`
        const existing = descriptor.capabilities.find(capability => capability.id === capabilityId)
        const record: PluginCapabilityRecord = {
          id: capabilityId,
          owner: manifest.name,
          type: 'desktop.sharedConfigEndpoint',
          layer: 'desktop',
          status: 'registered',
          label: key,
          metadata: {
            envVar: `CRADLE_PLUGIN_${key.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`,
            compatibilityPath: true,
          },
        }
        if (existing) {
          Object.assign(existing, record)
        } else {
          addCapabilityRecord(descriptor, record)
        }
      }
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
  const sources = createDesktopPluginSources(isDev)

  desktopPluginDescriptors.clear()
  invalidDesktopPluginDescriptors.length = 0

  const { manifests, descriptors } = await discoverDesktopPlugins(sources)
  for (const descriptor of descriptors) {
    if (!descriptor.identity || isRejectedDescriptor(descriptor)) {
      invalidDesktopPluginDescriptors.push(descriptor)
    } else {
      desktopPluginDescriptors.set(descriptor.identity, descriptor)
    }
  }

  const desktopPlugins = manifests.filter(m => m.cradle.desktop)

  for (const manifest of desktopPlugins) {
    const entryPath = resolve(manifest.packageDir, manifest.cradle.desktop!)
    const descriptor = desktopPluginDescriptors.get(manifest.name)
    if (descriptor) {
      setDesktopLayerStatus(descriptor, 'activating')
    }

    try {
      const mod = await import(entryPath)
      validatePluginModule(mod, manifest.name)

      const ctx = createDesktopPluginContext(manifest)
      await mod.activate(ctx)

      activePlugins.set(manifest.name, { deactivate: mod.deactivate as (() => void | Promise<void>) | undefined })
      if (descriptor) {
        setDesktopLayerStatus(descriptor, 'active')
      }
      console.log(`[plugins] desktop activated: ${manifest.name}`)
    } catch (err) {
      if (descriptor) {
        setDesktopLayerStatus(descriptor, 'failed', formatError(err))
      }
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
