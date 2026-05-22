import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const runtimePackages = [
  '@node-rs/jieba',
  '@node-rs/jieba-darwin-arm64',
  'better-sqlite3',
  'bindings',
  'file-uri-to-path',
  'node-addon-api',
  'node-pty',
]

const nativeRuntimePackages = [
  'better-sqlite3',
  'node-pty',
]

const distRoot = fileURLToPath(new URL('../dist/', import.meta.url))
const distNodeModules = fileURLToPath(new URL('../dist/node_modules/', import.meta.url))
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))

rmSync(distNodeModules, { recursive: true, force: true })

for (const packageName of runtimePackages) {
  const packageJsonPath = require.resolve(`${packageName}/package.json`)
  const packageDir = dirname(packageJsonPath)
  const targetDir = join(distNodeModules, packageName)

  cpSync(packageDir, targetDir, {
    recursive: true,
    dereference: true,
    filter: source => {
      const rel = relative(packageDir, source)
      return !rel.startsWith('.git') && !rel.includes('/.git/')
    },
  })
}

mkdirSync(join(distRoot, 'modules/chronicle'), { recursive: true })
cpSync(
  join(sourceRoot, 'modules/chronicle/mcp-server.mjs'),
  join(distRoot, 'modules/chronicle/mcp-server.mjs'),
)

writeFileSync(
  join(distRoot, 'package.json'),
  `${JSON.stringify({
    name: '@cradle/server-runtime',
    private: true,
    type: 'module',
    dependencies: Object.fromEntries(nativeRuntimePackages.map(packageName => [packageName, '*'])),
  }, null, 2)}\n`,
  'utf8',
)
