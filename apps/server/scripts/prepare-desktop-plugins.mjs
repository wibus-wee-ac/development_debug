#!/usr/bin/env node
/**
 * Output: Creates apps/server/dist/desktop-plugins as the first-party plugin artifact consumed by Cradle desktop packaging.
 * Input: plugins/* package manifests and built plugin dist directories.
 * Position: Server-owned desktop plugin packaging boundary; desktop includes this artifact without enumerating plugin packages.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const serverRoot = resolve(scriptDir, '..')
const repoRoot = resolve(serverRoot, '../..')
const pluginsRoot = join(repoRoot, 'plugins')
const artifactDir = join(serverRoot, 'dist', 'desktop-plugins')

rmSync(artifactDir, { recursive: true, force: true })
mkdirSync(artifactDir, { recursive: true })

const includedPlugins = readdirSync(pluginsRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => preparePlugin(entry.name))
  .filter(plugin => plugin !== null)

writeFileSync(
  join(artifactDir, 'desktop-plugins.json'),
  `${JSON.stringify(
    {
      kind: 'cradle.desktop-plugins',
      plugins: includedPlugins,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
  'utf8',
)

console.log(`Prepared desktop plugins at ${relative(repoRoot, artifactDir)}`)

function preparePlugin(directoryName) {
  const packageDir = join(pluginsRoot, directoryName)
  const packageJsonPath = join(packageDir, 'package.json')
  const distDir = join(packageDir, 'dist')

  if (!existsSync(packageJsonPath)) {
    return null
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  const cradle = packageJson.cradle
  if (!cradle || !isDesktopDeployment(cradle.deployments)) {
    return null
  }

  if (!existsSync(distDir)) {
    throw new Error(`Plugin ${packageJson.name ?? directoryName} has no dist directory. Run its build before preparing desktop plugins.`)
  }

  const pluginArtifactDir = join(artifactDir, directoryName)
  mkdirSync(pluginArtifactDir, { recursive: true })
  cpSync(packageJsonPath, join(pluginArtifactDir, 'package.json'))
  cpSync(distDir, join(pluginArtifactDir, 'dist'), { recursive: true })

  return {
    name: packageJson.name,
    version: packageJson.version ?? '0.0.0',
    directoryName,
  }
}

function isDesktopDeployment(deployments) {
  if (deployments === undefined) {
    return true
  }
  return Array.isArray(deployments) && deployments.includes('desktop')
}
