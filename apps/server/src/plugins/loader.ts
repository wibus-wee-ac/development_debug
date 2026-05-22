import { readFile } from 'node:fs/promises'
import { basename, delimiter, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Elysia } from 'elysia'
import type { Disposable, PluginManifest, PluginSourceDescriptor, PluginSourceKind } from '@cradle/plugin-sdk'
import { evaluatePluginPermissionPolicy } from '@cradle/plugin-sdk/permissions'
import type { ServerPluginContext } from '@cradle/plugin-sdk/server'
import { createChildLogger } from '../logging/logger'
import { createServerPluginContext } from './context'
import { discoverPluginPackages, type DiscoveredPluginPackage } from './discovery'
import { resetExternalProviderSourceRegistry } from './external-provider-source-registry'
import {
  classifyPluginSource,
  createInvalidPluginDescriptor,
  createPluginDescriptor,
  listPluginDescriptors,
  registerPluginDescriptor,
  resetPluginRuntimeRegistry,
  setPluginLayerState,
} from './runtime-registry'
import { createPluginStaticServer } from './static-server'
import { validatePluginModule } from './validation'

// Store deactivation functions for shutdown
const activePlugins = new Map<string, { deactivate?: () => void | Promise<void>; subscriptions: Disposable[] }>()
const logger = createChildLogger({ module: 'plugins' })

interface PluginDiscoverySource {
  pluginsDir: string
  kind?: PluginSourceKind
  trustMarketplaceGrants?: boolean
}

interface PackageWithSource {
  pkg: DiscoveredPluginPackage
  source: PluginSourceDescriptor
}

function readPrimaryPluginSourceKind(): PluginSourceKind | undefined {
  const value = process.env.CRADLE_PLUGINS_SOURCE_KIND
  if (value === 'workspaceDev' || value === 'bundledResource' || value === 'externalLocal') {
    return value
  }
  return process.env.CRADLE_PLUGINS_DIR ? 'externalLocal' : undefined
}

function readMarketplacePluginsDir(): string | undefined {
  const value = process.env.CRADLE_MARKETPLACE_PLUGINS_DIR?.trim()
  return value ? resolve(value) : undefined
}

function getPluginDiscoverySources(defaultPluginsDir: string): PluginDiscoverySource[] {
  const marketplacePluginsDir = readMarketplacePluginsDir()
  const externalDirs = (process.env.CRADLE_EXTERNAL_PLUGINS_DIRS ?? '')
    .split(delimiter)
    .map(dir => dir.trim())
    .filter(Boolean)

  const sources: PluginDiscoverySource[] = []
  const addSource = (pluginsDir: string, kind?: PluginSourceKind): void => {
    const normalizedDir = resolve(pluginsDir)
    if (sources.some(source => resolve(source.pluginsDir) === normalizedDir)) return
    sources.push({
      pluginsDir,
      kind,
      trustMarketplaceGrants: marketplacePluginsDir === normalizedDir,
    })
  }

  addSource(defaultPluginsDir, readPrimaryPluginSourceKind())
  for (const pluginsDir of externalDirs) {
    addSource(pluginsDir, 'externalLocal')
  }
  return sources
}

async function discoverPackagesFromSources(sources: PluginDiscoverySource[]): Promise<PackageWithSource[]> {
  const packages: PackageWithSource[] = []
  for (const source of sources) {
    const discovered = await discoverPluginPackages(source.pluginsDir)
    for (const pkg of discovered) {
      packages.push({
        pkg,
        source: {
          ...classifyPluginSource(pkg.packageDir, source.pluginsDir, source.kind),
          provenance: pkg.provenance,
          grantedPermissions: source.trustMarketplaceGrants ? pkg.provenance?.grantedPermissions : undefined,
        },
      })
    }
  }
  return packages
}

function disposeSubscriptions(name: string, subscriptions: Disposable[]): void {
  for (const subscription of [...subscriptions].reverse()) {
    try {
      subscription.dispose()
    } catch (err) {
      logger.error('plugin subscription disposal failed', { plugin: name, err })
    }
  }
  subscriptions.length = 0
}

export async function activateServerPlugins(app: Elysia): Promise<void> {
  // Discover from plugins/ relative to workspace root
  // In dev: CRADLE_PLUGINS_DIR env or traverse up from this file. In prod: process.resourcesPath or cwd
  const thisDir = dirname(fileURLToPath(import.meta.url))
  const pluginsDir = process.env.CRADLE_PLUGINS_DIR
    ?? resolve(thisDir, '../../../../plugins')
  const packages = await discoverPackagesFromSources(getPluginDiscoverySources(pluginsDir))
  resetPluginRuntimeRegistry()
  resetExternalProviderSourceRegistry()

  for (const { pkg, source } of packages) {
    if (!pkg.manifest) {
      const identity = `invalid:${basename(pkg.packageDir)}`
      registerPluginDescriptor(createInvalidPluginDescriptor(identity, '0.0.0', source, pkg.error ?? 'Invalid plugin package.'))
      continue
    }
    registerPluginDescriptor(createPluginDescriptor(pkg.manifest, source))
  }

  const descriptors = listPluginDescriptors()
  const manifests: PluginManifest[] = packages.flatMap(({ pkg }) => pkg.manifest ? [pkg.manifest] : [])

  if (descriptors.length === 0) return

  for (const manifest of manifests.filter(m => m.cradle.web)) {
    const descriptor = descriptors.find(d => d.identity === manifest.name)
    if (!descriptor || descriptor.layers.web.status === 'invalid') continue
    const permissionDecision = evaluatePluginPermissionPolicy(descriptor, 'web', process.env)
    if (!permissionDecision.allowed) {
      setPluginLayerState(manifest.name, 'web', 'disabled', permissionDecision.reason)
      logger.warn('plugin web layer disabled by permission policy', {
        plugin: manifest.name,
        missingRequiredPermissions: permissionDecision.missingRequiredPermissions,
      })
    }
  }

  // Activate server plugins
  const serverPlugins = manifests.filter(m => m.cradle.server)
  for (const manifest of serverPlugins) {
    const descriptor = descriptors.find(d => d.identity === manifest.name)
    if (!descriptor || descriptor.layers.server.status === 'invalid') continue
    const permissionDecision = evaluatePluginPermissionPolicy(descriptor, 'server', process.env)
    if (!permissionDecision.allowed) {
      setPluginLayerState(manifest.name, 'server', 'disabled', permissionDecision.reason)
      logger.warn('plugin server layer disabled by permission policy', {
        plugin: manifest.name,
        missingRequiredPermissions: permissionDecision.missingRequiredPermissions,
      })
      continue
    }
    const entryPath = resolve(manifest.packageDir, manifest.cradle.server!)
    let subscriptions: Disposable[] = []
    try {
      setPluginLayerState(manifest.name, 'server', 'activating')
      const mod = await import(entryPath)
      validatePluginModule(mod, manifest.name, 'server')

      const pluginApp = new Elysia({ prefix: `/api/plugins/${descriptor.routeSegment}` })

      const ctx = createServerPluginContext(manifest, pluginApp)
      subscriptions = ctx.subscriptions
      await mod.activate(ctx)
      app.use(pluginApp)

      activePlugins.set(manifest.name, {
        deactivate: mod.deactivate as (() => void | Promise<void>) | undefined,
        subscriptions: ctx.subscriptions,
      })
      setPluginLayerState(manifest.name, 'server', 'active')
      logger.info('plugin activated', { plugin: manifest.name })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setPluginLayerState(manifest.name, 'server', 'failed', message)
      disposeSubscriptions(manifest.name, subscriptions)
      logger.error('plugin activation failed', { plugin: manifest.name, err })
    }
  }

  // Plugin static server — serves web entries + plugin list API
  const staticServer = createPluginStaticServer(manifests)

  const pluginRoutes = new Elysia({ prefix: '/api/plugins' })
    .get('/', () => staticServer.getPluginList())
    .get('/:name/web.mjs', async ({ params, set }) => {
      const entryPath = staticServer.getWebEntry(params.name)
      if (!entryPath) {
        set.status = 404
        return 'Not found'
      }
      const content = await readFile(entryPath, 'utf-8')
      return new Response(content, {
        headers: { 'content-type': 'application/javascript; charset=utf-8' },
      })
    })

  app.use(pluginRoutes)
}

export async function deactivateAllPlugins(): Promise<void> {
  for (const [name, plugin] of activePlugins) {
    try {
      await plugin.deactivate?.()
    } catch (err) {
      logger.error('plugin deactivation failed', { plugin: name, err })
    } finally {
      disposeSubscriptions(name, plugin.subscriptions)
    }
  }
  activePlugins.clear()
}
