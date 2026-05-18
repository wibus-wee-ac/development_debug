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
}

/** Plugin-scoped logger */
export interface Logger {
  info(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
  debug(msg: string, ...args: unknown[]): void
}
