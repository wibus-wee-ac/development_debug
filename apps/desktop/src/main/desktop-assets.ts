import { join } from 'node:path'

import { app } from 'electron'

export function resolveDesktopPreloadPath(moduleDir: string): string {
  if (process.env.ELECTRON_RENDERER_URL) {
    return join(moduleDir, '../preload/index.js')
  }
  return join(app.getAppPath(), 'dist/preload/index.js')
}

export function resolveDesktopRendererIndexPath(): string {
  return join(app.getAppPath(), 'dist/renderer/index.html')
}
