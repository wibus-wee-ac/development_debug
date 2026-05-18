import type { Disposable, Logger, PluginManifest } from './index'

export type { Disposable, Logger, PluginManifest } from './index'

/** Desktop plugin context — provided by Electron main process host */
export interface DesktopPluginContext {
  /** Electron userData path */
  userDataPath: string

  /** Listen for webview creation — receives raw WebContents */
  onWebviewCreated(handler: (wc: unknown, tabId: string) => void): Disposable

  /** Write to shared config bus — values propagated to server via env vars */
  setSharedConfig(key: string, value: string): void

  /** Plugin-scoped logger */
  logger: Logger

  /** Plugin manifest metadata */
  manifest: PluginManifest
}

/** Desktop plugin module shape */
export interface DesktopPlugin {
  activate(ctx: DesktopPluginContext): void | Promise<void>
  deactivate?(): void | Promise<void>
}
