import type { Dirent } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type {
  CradlePluginMeta,
  PluginDescriptor,
  PluginLayer,
  PluginLayerState,
  PluginManifest,
  PluginSourceDescriptor,
  PluginSourceKind,
} from '@cradle/plugin-sdk'
import { derivePluginRouteSegment } from '@cradle/plugin-sdk'

export interface DesktopPluginSource {
  pluginsDir: string
  kind: PluginSourceKind
  trusted: boolean
  reason?: string
}

export interface DesktopPluginDiscoveryResult {
  manifests: PluginManifest[]
  descriptors: PluginDescriptor[]
}

interface DiscoveredPlugin {
  manifest: PluginManifest
  descriptor: PluginDescriptor
}

interface PackageJson {
  name?: unknown
  version?: unknown
  cradle?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readCradleMeta(value: unknown): CradlePluginMeta | undefined {
  if (!isRecord(value)) return undefined
  return value as CradlePluginMeta
}

function createLayerState(layer: PluginLayer, entry: string | undefined): PluginLayerState {
  return {
    layer,
    status: entry ? 'discovered' : 'skipped',
    entry,
  }
}

function createInvalidLayerState(layer: PluginLayer, error: string): PluginLayerState {
  return {
    layer,
    status: 'invalid',
    error,
  }
}

function createSourceDescriptor(source: DesktopPluginSource, packageDir: string): PluginSourceDescriptor {
  return {
    kind: source.kind,
    packageDir,
    trusted: source.trusted,
    reason: source.reason,
  }
}

function createDescriptor(manifest: PluginManifest, source: DesktopPluginSource): PluginDescriptor {
  const cradle = manifest.cradle

  return {
    identity: manifest.name,
    routeSegment: derivePluginRouteSegment(manifest.name),
    name: manifest.name,
    version: manifest.version,
    displayName: cradle.displayName ?? manifest.name,
    description: cradle.description,
    deployments: cradle.deployments,
    source: createSourceDescriptor(source, manifest.packageDir),
    layers: {
      server: createLayerState('server', cradle.server),
      web: createLayerState('web', cradle.web),
      desktop: createLayerState('desktop', cradle.desktop),
    },
    capabilities: [],
    warnings: [],
    hasWeb: Boolean(cradle.web),
    hasServer: Boolean(cradle.server),
    hasDesktop: Boolean(cradle.desktop),
    serverEntry: cradle.server,
    webEntry: cradle.web,
    desktopEntry: cradle.desktop,
  }
}

function createInvalidDescriptor(
  packageDir: string,
  source: DesktopPluginSource,
  directoryName: string,
  error: string,
): PluginDescriptor {
  return {
    identity: '',
    routeSegment: `invalid-${derivePluginRouteSegment(directoryName)}`,
    name: '',
    version: '0.0.0',
    displayName: directoryName,
    source: createSourceDescriptor(source, packageDir),
    layers: {
      server: createInvalidLayerState('server', error),
      web: createInvalidLayerState('web', error),
      desktop: createInvalidLayerState('desktop', error),
    },
    capabilities: [],
    warnings: [error],
    hasWeb: false,
    hasServer: false,
    hasDesktop: false,
  }
}

function markInvalid(descriptor: PluginDescriptor, error: string): void {
  descriptor.layers.server = createInvalidLayerState('server', error)
  descriptor.layers.web = createInvalidLayerState('web', error)
  descriptor.layers.desktop = createInvalidLayerState('desktop', error)
  descriptor.warnings.push(error)
}

function rejectDuplicateIdentities(discovered: DiscoveredPlugin[]): Set<PluginDescriptor> {
  const invalidDescriptors = new Set<PluginDescriptor>()
  const byIdentity = new Map<string, DiscoveredPlugin[]>()
  const byRouteSegment = new Map<string, DiscoveredPlugin[]>()

  for (const plugin of discovered) {
    const identityMatches = byIdentity.get(plugin.manifest.name) ?? []
    identityMatches.push(plugin)
    byIdentity.set(plugin.manifest.name, identityMatches)

    const routeMatches = byRouteSegment.get(plugin.descriptor.routeSegment) ?? []
    routeMatches.push(plugin)
    byRouteSegment.set(plugin.descriptor.routeSegment, routeMatches)
  }

  for (const [identity, matches] of byIdentity) {
    if (matches.length <= 1) continue
    for (const plugin of matches) {
      markInvalid(plugin.descriptor, `Duplicate package.json#name '${identity}'`)
      invalidDescriptors.add(plugin.descriptor)
    }
  }

  for (const [routeSegment, matches] of byRouteSegment) {
    if (matches.length <= 1) continue
    for (const plugin of matches) {
      markInvalid(plugin.descriptor, `Route segment collision '${routeSegment}'`)
      invalidDescriptors.add(plugin.descriptor)
    }
  }

  return invalidDescriptors
}

/**
 * Discover plugins from the plugins/ directory.
 * Same logic as server-side discovery but runs in Electron main.
 */
export async function discoverPlugins(pluginsDir: string): Promise<PluginManifest[]> {
  const result = await discoverDesktopPlugins([
    {
      pluginsDir,
      kind: 'workspaceDev',
      trusted: true,
      reason: 'Legacy desktop discovery source',
    },
  ])
  return result.manifests
}

export async function discoverDesktopPlugins(sources: DesktopPluginSource[]): Promise<DesktopPluginDiscoveryResult> {
  const discovered: DiscoveredPlugin[] = []
  const diagnostics: PluginDescriptor[] = []

  for (const source of sources) {
    await discoverDesktopPluginsFromSource(source, discovered, diagnostics)
  }

  const invalidDescriptors = rejectDuplicateIdentities(discovered)
  const manifests = discovered
    .filter(plugin => !invalidDescriptors.has(plugin.descriptor))
    .map(plugin => plugin.manifest)

  return {
    manifests,
    descriptors: [...diagnostics, ...discovered.map(plugin => plugin.descriptor)],
  }
}

async function discoverDesktopPluginsFromSource(
  source: DesktopPluginSource,
  discovered: DiscoveredPlugin[],
  diagnostics: PluginDescriptor[],
): Promise<void> {
  const pluginsDir = resolve(source.pluginsDir)

  let entries: Dirent[]
  try {
    entries = await readdir(pluginsDir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const directoryName = String(entry.name)
    const packageDir = resolve(pluginsDir, directoryName)
    const pkgPath = resolve(packageDir, 'package.json')
    try {
      const raw = await readFile(pkgPath, 'utf-8')
      const pkg = JSON.parse(raw) as PackageJson
      const cradle = readCradleMeta(pkg.cradle)
      if (!cradle) continue

      if (typeof pkg.name !== 'string' || pkg.name.trim() === '') {
        diagnostics.push(createInvalidDescriptor(
          packageDir,
          source,
          directoryName,
          'Missing required package.json#name',
        ))
        continue
      }

      const packageName = pkg.name.trim()
      const manifest: PluginManifest = {
        name: packageName,
        version: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
        packageDir,
        cradle,
      }
      discovered.push({
        manifest,
        descriptor: createDescriptor(manifest, source),
      })
    } catch (err) {
      diagnostics.push(createInvalidDescriptor(
        packageDir,
        source,
        directoryName,
        err instanceof Error ? err.message : 'Invalid package.json',
      ))
    }
  }
}
