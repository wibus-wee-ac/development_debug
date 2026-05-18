import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { PluginManifest } from '@cradle/plugin-sdk'

/**
 * Discover plugins from the plugins/ directory.
 * Same logic as server-side discovery but runs in Electron main.
 */
export async function discoverPlugins(pluginsDir: string): Promise<PluginManifest[]> {
  const manifests: PluginManifest[] = []

  let entries: { isDirectory(): boolean; name: string }[]
  try {
    entries = await readdir(pluginsDir, { withFileTypes: true }) as any
  } catch {
    return []
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const name = String(entry.name)
    const pkgPath = resolve(pluginsDir, name, 'package.json')
    try {
      const raw = await readFile(pkgPath, 'utf-8')
      const pkg = JSON.parse(raw)
      if (!pkg.cradle) continue
      manifests.push({
        name: pkg.name ?? name,
        version: pkg.version ?? '0.0.0',
        packageDir: resolve(pluginsDir, name),
        cradle: pkg.cradle,
      })
    } catch {
      // Skip invalid packages
    }
  }

  return manifests
}
