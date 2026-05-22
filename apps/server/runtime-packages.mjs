/**
 * Output: Shared production runtime package ownership for the server bundle.
 * Input: Vite externals, runtime dependency installation, and Electron rebuild.
 * Position: Owned by @cradle/server because these packages are required by the
 * packaged server process after the TypeScript sources are bundled.
 */

export const serverRuntimePackages = ['@node-rs/jieba', 'better-sqlite3', 'node-pty', 'sharp']

export const serverRuntimePackagePrefixes = ['@node-rs/jieba-']

export const electronRebuildPackages = ['better-sqlite3', 'node-pty']

export const runtimeBuildPackages = ['better-sqlite3', 'node-pty', 'sharp']
