// Input: electron-is-dev, node:path, node:fs
// Output: getBundledResourcePath, readBundledResource — resolve and read files bundled in resources/
// Position: Main-process utility for accessing app-bundled static resources

import { is } from '@electron-toolkit/utils'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Resolve the absolute filesystem path for a bundled resource.
 *
 * In development the resources/ folder lives at the repo root.
 * In production electron-builder copies it into the app's resourcesPath
 * and `asarUnpack: resources/**` keeps it on disk.
 */
export function getBundledResourcePath(relativePath: string): string {
  return is.dev
    ? path.join(__dirname, '../../resources', relativePath)
    : path.join(process.resourcesPath, relativePath)
}

/**
 * Read a bundled text resource, returning null when the file does not exist.
 */
export function readBundledResource(relativePath: string): string | null {
  const fullPath = getBundledResourcePath(relativePath)
  try {
    return fs.readFileSync(fullPath, 'utf-8')
  }
  catch {
    return null
  }
}
