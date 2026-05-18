import { readFile } from 'node:fs/promises'
import { basename, delimiter, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Elysia } from 'elysia'
import type { PluginManifest, PluginSourceDescriptor, PluginSourceKind } from '@cradle/plugin-sdk'
import { createServerPluginContext } from './context'
import { discoverPluginPackages, type DiscoveredPluginPackage } from './discovery'
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
const activePlugins = new Map<string, { deactivate?: () => void | Promise<void> }>()

interface PluginDiscoverySource {
  pluginsDir: string
  kind?: PluginSourceKind
}

interface PackageWithSource {
  pkg: DiscoveredPluginPackage
  source: PluginSourceDescriptor
}

function getPluginDiscoverySources(defaultPluginsDir: string): PluginDiscoverySource[] {
  const externalDirs = (process.env.CRADLE_EXTERNAL_PLUGINS_DIRS ?? '')
    .split(delimiter)
    .map(dir => dir.trim())
    .filter(Boolean)

  return [
    {
      pluginsDir: defaultPluginsDir,
      kind: process.env.CRADLE_PLUGINS_DIR ? 'externalLocal' : undefined,
    },
    ...externalDirs.map(pluginsDir => ({
      pluginsDir,
      kind: 'externalLocal' as const,
    })),
  ]
}

async function discoverPackagesFromSources(sources: PluginDiscoverySource[]): Promise<PackageWithSource[]> {
  const packages: PackageWithSource[] = []
  for (const source of sources) {
    const discovered = await discoverPluginPackages(source.pluginsDir)
    for (const pkg of discovered) {
      packages.push({
        pkg,
        source: classifyPluginSource(pkg.packageDir, source.pluginsDir, source.kind),
      })
    }
  }
  return packages
}

export async function activateServerPlugins(app: Elysia): Promise<void> {
  // Discover from plugins/ relative to workspace root
  // In dev: CRADLE_PLUGINS_DIR env or traverse up from this file. In prod: process.resourcesPath or cwd
  const thisDir = dirname(fileURLToPath(import.meta.url))
  const pluginsDir = process.env.CRADLE_PLUGINS_DIR
    ?? resolve(thisDir, '../../../../plugins')
  const packages = await discoverPackagesFromSources(getPluginDiscoverySources(pluginsDir))
  resetPluginRuntimeRegistry()

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

  // Activate server plugins
  const serverPlugins = manifests.filter(m => m.cradle.server)
  for (const manifest of serverPlugins) {
    const descriptor = descriptors.find(d => d.identity === manifest.name)
    if (!descriptor || descriptor.layers.server.status === 'invalid') continue
    const entryPath = resolve(manifest.packageDir, manifest.cradle.server!)
    try {
      setPluginLayerState(manifest.name, 'server', 'activating')
      const mod = await import(entryPath)
      validatePluginModule(mod, manifest.name, 'server')

      const pluginApp = new Elysia({ prefix: `/api/plugins/${descriptor.routeSegment}` })

      const ctx = createServerPluginContext(manifest, pluginApp)
      await mod.activate(ctx)
      app.use(pluginApp)

      activePlugins.set(manifest.name, { deactivate: mod.deactivate as (() => void | Promise<void>) | undefined })
      setPluginLayerState(manifest.name, 'server', 'active')
      console.log(`[plugins] activated: ${manifest.name}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setPluginLayerState(manifest.name, 'server', 'failed', message)
      console.error(`[plugins] failed to activate ${manifest.name}:`, err)
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
      console.error(`[plugins] error deactivating ${name}:`, err)
    }
  }
  activePlugins.clear()
}
