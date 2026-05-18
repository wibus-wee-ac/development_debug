import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { PluginManifest } from '@cradle/plugin-sdk'

export interface DiscoveredPluginPackage {
  packageDir: string
  manifest?: PluginManifest
  error?: string
}

/**
 * Discover plugins from the plugins/ directory.
 * Reads each subdirectory's package.json for a "cradle" field.
 */
export async function discoverPlugins(pluginsDir: string): Promise<PluginManifest[]> {
  const packages = await discoverPluginPackages(pluginsDir)
  return packages.flatMap(pkg => pkg.manifest ? [pkg.manifest] : [])
}

export async function discoverPluginPackages(pluginsDir: string): Promise<DiscoveredPluginPackage[]> {
  const packages: DiscoveredPluginPackage[] = []

  let entries: { isDirectory(): boolean; name: string }[]
  try {
    entries = await readdir(pluginsDir, { withFileTypes: true }) as any
  } catch {
    return [] // plugins dir doesn't exist
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const name = String(entry.name)
    const packageDir = resolve(pluginsDir, name)
    const pkgPath = resolve(pluginsDir, name, 'package.json')
    try {
      const raw = await readFile(pkgPath, 'utf-8')
      const pkg = JSON.parse(raw)
      if (!pkg.cradle) continue
      if (typeof pkg.name !== 'string' || pkg.name.trim() === '') {
        packages.push({
          packageDir,
          error: 'Plugin package.json must define a non-empty name.',
        })
        continue
      }
      const manifest = {
        name: pkg.name,
        version: pkg.version ?? '0.0.0',
        packageDir,
        cradle: pkg.cradle,
      }
      packages.push({ packageDir, manifest })
    } catch (err) {
      packages.push({
        packageDir,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return packages
}
