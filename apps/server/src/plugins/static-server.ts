import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PluginManifest } from '@cradle/plugin-sdk'

/**
 * Creates a plugin static server that serves web plugin entries as static assets.
 * GET /api/plugins/:name/web.mjs → returns the plugin's web bundle
 * GET /api/plugins → returns list of active plugins
 */
export function createPluginStaticServer(manifests: PluginManifest[]) {
  return {
    manifests,
    getWebEntry(pluginName: string): string | null {
      const manifest = manifests.find((m) => {
        const shortName = m.name.replace(/^@cradle\/plugin-/, '').replace(/^@cradle\//, '')
        return shortName === pluginName || m.name === pluginName
      })
      if (!manifest?.cradle.web) return null
      const entryPath = resolve(manifest.packageDir, manifest.cradle.web)
      return existsSync(entryPath) ? entryPath : null
    },
    getPluginList() {
      return manifests.map(m => ({
        name: m.name,
        version: m.version,
        displayName: m.cradle.displayName ?? m.name,
        description: m.cradle.description,
        deployments: m.cradle.deployments,
        hasWeb: !!m.cradle.web,
        hasServer: !!m.cradle.server,
        hasDesktop: !!m.cradle.desktop,
        serverEntry: m.cradle.server ?? undefined,
        webEntry: m.cradle.web ?? undefined,
        desktopEntry: m.cradle.desktop ?? undefined,
      }))
    },
  }
}
