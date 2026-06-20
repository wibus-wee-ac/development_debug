import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import type { PluginManifest } from '@cradle/plugin-sdk'

import { getPluginDescriptorByRouteSegment, listPluginDescriptors, setPluginLayerState } from './runtime-registry'

/**
 * Creates a plugin static server that serves web plugin entries as static assets.
 * GET /api/plugins/:name/web.mjs → returns the plugin's web bundle
 * GET /api/plugins → returns list of active plugins
 */
export function createPluginStaticServer(manifests: PluginManifest[]) {
  return {
    manifests,
    getWebEntry(pluginName: string): string | null {
      const descriptor = getPluginDescriptorByRouteSegment(pluginName)
      if (descriptor?.layers.web.status === 'invalid' || descriptor?.layers.web.status === 'disabled') {
        return null
      }
      const manifest = descriptor
        ? manifests.find(m => m.name === descriptor.identity)
        : manifests.find(m => m.name === pluginName)
      if (!manifest?.cradle.web) { return null }
      const entryPath = resolve(manifest.packageDir, manifest.cradle.web)
      if (existsSync(entryPath)) {
        return entryPath
      }

      setPluginLayerState(manifest.name, 'web', 'failed', `Web entry is missing: ${manifest.cradle.web}`)
      return null
    },
    getPluginList() {
      return listPluginDescriptors()
    },
  }
}
