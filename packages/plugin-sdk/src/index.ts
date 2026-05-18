/** Disposable subscription — call dispose() to unregister */
export interface Disposable {
  dispose(): void
}

/** Plugin manifest as parsed from package.json */
export interface PluginManifest {
  /** npm package name */
  name: string
  /** Package version */
  version: string
  /** Absolute path to the plugin package directory */
  packageDir: string
  /** The cradle-specific metadata from package.json */
  cradle: CradlePluginMeta
}

export interface CradlePluginMeta {
  /** Plugin contract version. Missing value is treated as legacy v0 metadata. */
  apiVersion?: string
  displayName?: string
  description?: string
  /** Which deployments this plugin supports */
  deployments?: Array<'desktop' | 'web'>
  /** Entry point for server-side plugin */
  server?: string
  /** Entry point for web/renderer plugin */
  web?: string
  /** Entry point for desktop/Electron main plugin */
  desktop?: string
  /** Declared capability ids or categories owned by this plugin. */
  capabilities?: string[]
  /** Declared high-level host permissions requested by this plugin. */
  permissions?: string[]
}

/** Plugin-scoped logger */
export interface Logger {
  info(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
  debug(msg: string, ...args: unknown[]): void
}

export type PluginSourceKind = 'workspaceDev' | 'bundledResource' | 'externalLocal'

export type PluginLayer = 'server' | 'web' | 'desktop'

export type PluginLayerStatus =
  | 'discovered'
  | 'invalid'
  | 'skipped'
  | 'disabled'
  | 'activating'
  | 'active'
  | 'failed'
  | 'partial'

export interface PluginSourceDescriptor {
  kind: PluginSourceKind
  packageDir: string
  trusted: boolean
  reason?: string
}

export interface PluginLayerState {
  layer: PluginLayer
  status: PluginLayerStatus
  entry?: string
  error?: string
  activatedAt?: string
}

export type PluginCapabilityStatus = 'registered' | 'failed' | 'unsupported'

export interface PluginCapabilityRecord {
  id: string
  owner: string
  type: string
  layer: PluginLayer
  status: PluginCapabilityStatus
  label?: string
  metadata?: Record<string, unknown>
}

export interface PluginDescriptor {
  identity: string
  routeSegment: string
  name: string
  version: string
  displayName: string
  description?: string
  deployments?: Array<'desktop' | 'web'>
  source: PluginSourceDescriptor
  layers: Record<PluginLayer, PluginLayerState>
  capabilities: PluginCapabilityRecord[]
  warnings: string[]
  hasWeb: boolean
  hasServer: boolean
  hasDesktop: boolean
  serverEntry?: string
  webEntry?: string
  desktopEntry?: string
}

export function derivePluginRouteSegment(identity: string): string {
  if (identity.startsWith('@cradle/plugin-')) {
    return identity.slice('@cradle/plugin-'.length)
  }
  if (identity.startsWith('@cradle/')) {
    return identity.slice('@cradle/'.length)
  }
  if (identity.startsWith('@')) {
    const [scope, name] = identity.slice(1).split('/')
    if (scope && name) {
      return `scope-${scope}--${name}`.replace(/[^a-zA-Z0-9._~-]/g, '-')
    }
  }
  return identity.replace(/[^a-zA-Z0-9._~-]/g, '-')
}

export function derivePluginCapabilityId(owner: string, localId: string): string {
  return `${owner}:${localId}`
}
