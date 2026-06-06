import type { ChildProcess } from 'node:child_process'
import { fork } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'

import { app, dialog } from 'electron'
import getPort from 'get-port'
import { z } from 'zod'

import { resolveDesktopInstalledPluginsDir } from './plugin-install-links'
import { getPluginEnvVars } from './plugin-loader'
import { resolveDesktopPrimaryPluginsDir, resolveDesktopPrimaryPluginsSourceKind } from './plugin-paths'

let serverProcess: ChildProcess | null = null
let restartCount = 0
let isServerShutdownRequested = false
let locatedServerPid: number | null = null
const MAX_RESTARTS = 3
const SERVER_STARTUP_TIMEOUT_MS = 90_000
const SERVER_RESTART_READY_TIMEOUT_MS = 60_000
const SERVER_OUTPUT_LINE_LIMIT = 200
const CREDENTIAL_SECRET_FILE = 'credential-secret'
const SAFE_STORAGE_PREFIX = 'v1-safe:'
const PLAIN_STORAGE_PREFIX = 'v1-plain:'
const KEYCHAIN_BACKUP_SUFFIX = '.keychain-backup'
const CLI_SERVER_LOCATOR_FILE = 'cli/server.json'
const ExternalPluginsDirsSchema = z.array(z.string().optional())
  .transform(values => values.flatMap(value => value?.trim() ? [value.trim()] : []))
const ServerLocatorSchema = z.object({
  serverUrl: z.string().url(),
  pid: z.number().int().positive().nullable().optional(),
  version: z.string().optional(),
  updatedAt: z.string().optional(),
})
let currentServerUrl = ''
const recentServerOutputLines: string[] = []

function resolveDevServerEntry(): string {
  const candidates = [
    resolve(process.cwd(), '../server/src/index.ts'),
    resolve(process.cwd(), 'apps/server/src/index.ts'),
    resolve(__dirname, '../../../../../apps/server/src/index.ts'),
  ]

  const entry = candidates.find(candidate => existsSync(candidate))
  if (!entry) {
    throw new Error(`Cannot find development server entry. Tried: ${candidates.join(', ')}`)
  }
  return entry
}

/**
 * Start the Cradle server as a forked child process.
 * Returns the full URL the server is listening on.
 */
export async function startServer(): Promise<string> {
  isServerShutdownRequested = false
  restartCount = 0

  const dataDir = join(app.getPath('userData'), 'data')
  const credentialSecret = resolveDesktopCredentialSecret(dataDir)
  const existingServer = await readHealthyLocatedServerUrl(app.getPath('userData'))
  if (existingServer) {
    currentServerUrl = existingServer.serverUrl
    locatedServerPid = existingServer.pid
    console.warn(`[desktop] Reusing existing server on ${currentServerUrl}`)
    return currentServerUrl
  }

  const port = await getPort({ port: [21423, 21424, 21425, 21426] })
  const host = '127.0.0.1'
  currentServerUrl = `http://${host}:${port}`

  await spawnServer({ host, port, dataDir, credentialSecret })

  // Wait for server to be ready
  await waitForServer(currentServerUrl, SERVER_STARTUP_TIMEOUT_MS)
  writeCliServerLocator({
    dataDir: app.getPath('userData'),
    serverUrl: currentServerUrl,
  })

  console.warn(`[desktop] Server started on ${currentServerUrl}`)
  return currentServerUrl
}

async function readHealthyLocatedServerUrl(dataDir: string): Promise<{ serverUrl: string, pid: number | null } | null> {
  const locatorPath = join(dataDir, CLI_SERVER_LOCATOR_FILE)
  if (!existsSync(locatorPath)) {
    return null
  }

  try {
    const locator = ServerLocatorSchema.parse(JSON.parse(readFileSync(locatorPath, 'utf8')))
    await waitForServer(locator.serverUrl, 1_000)
    return { serverUrl: locator.serverUrl, pid: locator.pid ?? null }
  }
  catch {
    removeCliServerLocator()
    return null
  }
}

function writeCliServerLocator(input: { dataDir: string, serverUrl: string }): void {
  const locatorPath = join(input.dataDir, CLI_SERVER_LOCATOR_FILE)
  mkdirSync(dirname(locatorPath), { recursive: true })
  writeFileSync(
    locatorPath,
    `${JSON.stringify(
      {
        serverUrl: input.serverUrl,
        pid: serverProcess?.pid ?? null,
        version: app.getVersion(),
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    { encoding: 'utf8', mode: 0o600 },
  )
}

function removeCliServerLocator(): void {
  try {
    rmSync(join(app.getPath('userData'), CLI_SERVER_LOCATOR_FILE), { force: true })
  }
  catch {
    // Shutdown should not fail because the optional CLI locator cannot be cleared.
  }
}

async function spawnServer(opts: { host: string, port: number, dataDir: string, credentialSecret: string }): Promise<void> {
  const { host, port, dataDir, credentialSecret } = opts

  // In dev, use tsx to run the TS source directly
  // In production, run the compiled server entry
  const isDev = !!process.env.ELECTRON_RENDERER_URL
  const serverEntry = isDev
    ? resolveDevServerEntry()
    : join(process.resourcesPath, 'server/dist/main.js')

  const execArgv = isDev ? ['--import', 'tsx'] : []
  const execPath = isDev ? resolveDevNodeExecPath() : undefined
  const pluginsDir = resolveDesktopPrimaryPluginsDir({ isDev, moduleDir: __dirname })
  const pluginsSourceKind = resolveDesktopPrimaryPluginsSourceKind({ isDev })
  const configuredMigrationsDir = process.env.CRADLE_MIGRATIONS_DIR?.trim()
  const migrationsDir = configuredMigrationsDir || (isDev ? undefined : join(process.resourcesPath, 'drizzle'))
  const builtinSkillsDir = isDev ? undefined : join(process.resourcesPath, 'resources/skills')
  const installedPluginsDir = resolveDesktopInstalledPluginsDir(app.getPath('userData'))
  const externalPluginsDirs = [
    installedPluginsDir,
    process.env.CRADLE_EXTERNAL_PLUGINS_DIRS,
  ]
  const externalPluginsDirList = ExternalPluginsDirsSchema.parse(externalPluginsDirs).join(delimiter)
  const serverEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...getPluginEnvVars(),
    CRADLE_HOST: host,
    CRADLE_PORT: String(port),
    CRADLE_DATA_DIR: dataDir,
    CRADLE_VERSION: app.getVersion(),
    CRADLE_CREDENTIAL_SECRET: credentialSecret,
    CRADLE_PLUGINS_DIR: pluginsDir,
    CRADLE_PLUGINS_SOURCE_KIND: pluginsSourceKind,
    CRADLE_EXTERNAL_PLUGINS_DIRS: externalPluginsDirList,
    CRADLE_MARKETPLACE_PLUGINS_DIR: installedPluginsDir,
    ...(migrationsDir ? { CRADLE_MIGRATIONS_DIR: migrationsDir } : {}),
    ...(builtinSkillsDir ? { CRADLE_BUILTIN_SKILLS_DIR: builtinSkillsDir } : {}),
    NODE_ENV: isDev ? 'development' : 'production',
    FORCE_COLOR: '1',
  }
  delete serverEnv.NO_COLOR

  serverProcess = fork(serverEntry, [], {
    env: serverEnv,
    execPath,
    execArgv,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  locatedServerPid = serverProcess.pid ?? null

  serverProcess.stdout?.on('data', chunk => recordServerOutput('stdout', chunk))
  serverProcess.stderr?.on('data', chunk => recordServerOutput('stderr', chunk))
  serverProcess.on('error', (err) => {
    const message = `[server:error] ${err instanceof Error ? err.stack ?? err.message : String(err)}`
    appendServerOutputLine(message)
    console.error(message)
  })
  serverProcess.on('exit', (code, signal) => {
    if (isServerShutdownRequested || signal === 'SIGTERM' || signal === 'SIGKILL') {
      // Intentional shutdown
      return
    }

    console.error(`[desktop] Server process exited unexpectedly (code=${code}, signal=${signal})`)
    removeCliServerLocator()

    if (restartCount < MAX_RESTARTS) {
      restartCount++
      console.warn(`[desktop] Restarting server (attempt ${restartCount}/${MAX_RESTARTS})...`)
      spawnServer(opts)
        .then(() => waitForServer(currentServerUrl, SERVER_RESTART_READY_TIMEOUT_MS))
        .then(() => {
          writeCliServerLocator({
            dataDir: app.getPath('userData'),
            serverUrl: currentServerUrl,
          })
        })
        .catch((err) => {
          console.error('[desktop] Server restart failed:', err)
          showServerCrashDialog(code)
        })
    }
    else {
      showServerCrashDialog(code)
    }
  })
}

function recordServerOutput(source: 'stdout' | 'stderr', chunk: Buffer | string): void {
  const text = chunk.toString()
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (!line) {
      continue
    }

    const message = `[server:${source}] ${line}`
    appendServerOutputLine(message)
    if (source === 'stderr') {
      console.error(message)
    }
    else {
      console.warn(message)
    }
  }
}

function appendServerOutputLine(line: string): void {
  recentServerOutputLines.push(line)
  if (recentServerOutputLines.length > SERVER_OUTPUT_LINE_LIMIT) {
    recentServerOutputLines.splice(0, recentServerOutputLines.length - SERVER_OUTPUT_LINE_LIMIT)
  }
}

function createServerStartupError(url: string, timeoutMs: number): Error {
  const recentOutput = recentServerOutputLines.slice(-40).join('\n')
  if (!recentOutput) {
    return new Error(`Server failed to start within ${timeoutMs}ms at ${url}`)
  }
  return new Error(
    `Server failed to start within ${timeoutMs}ms at ${url}\n\nRecent server output:\n${recentOutput}`,
  )
}

/**
 * Detach the desktop-owned reference to the server without stopping it.
 *
 * A normal app quit is only an observer disappearing; Chat Runtime still owns
 * active run lifecycle. The CLI locator is intentionally left in place so the
 * next desktop process can reattach to the same server.
 */
export function detachServer(): void {
  const child = serverProcess
  if (!child) {
    return
  }

  isServerShutdownRequested = true
  child.removeAllListeners('exit')
  child.removeAllListeners('error')
  if (child.connected) {
    child.disconnect()
  }
  child.unref()
  serverProcess = null
}

function resolveDevNodeExecPath(): string {
  // npm_node_execpath may point to pnpm or another package manager, not Node.js.
  // Check the resolved path to ensure we get a real node binary.
  const candidate = process.env.npm_node_execpath ?? process.env.NODE ?? 'node'
  const basename = candidate.split('/').pop()?.split('\\').pop()
  if (basename === 'node' || basename?.includes('node')) {
    return candidate
  }
  return 'node'
}

function resolveDesktopCredentialSecret(dataDir: string): string {
  const configuredSecret = process.env.CRADLE_CREDENTIAL_SECRET?.trim()
  if (configuredSecret) {
    return configuredSecret
  }

  mkdirSync(dataDir, { recursive: true })
  const secretPath = join(dataDir, CREDENTIAL_SECRET_FILE)
  if (existsSync(secretPath)) {
    return readDesktopCredentialSecret(secretPath)
  }

  const secret = randomBytes(32).toString('base64url')
  writeDesktopCredentialSecret(secretPath, secret)
  return secret
}

function readDesktopCredentialSecret(secretPath: string): string {
  const serializedSecret = readFileSync(secretPath, 'utf8').trim()
  if (serializedSecret.startsWith(SAFE_STORAGE_PREFIX)) {
    const secret = randomBytes(32).toString('base64url')
    archiveKeychainBackedSecret(secretPath)
    writeDesktopCredentialSecret(secretPath, secret)
    return secret
  }
  if (serializedSecret.startsWith(PLAIN_STORAGE_PREFIX)) {
    return serializedSecret.slice(PLAIN_STORAGE_PREFIX.length)
  }
  return serializedSecret
}

function writeDesktopCredentialSecret(secretPath: string, secret: string): void {
  writeFileSync(secretPath, `${PLAIN_STORAGE_PREFIX}${secret}`, { encoding: 'utf8', mode: 0o600 })
}

function archiveKeychainBackedSecret(secretPath: string): void {
  const backupPath = `${secretPath}${KEYCHAIN_BACKUP_SUFFIX}`
  if (existsSync(backupPath)) {
    return
  }
  renameSync(secretPath, backupPath)
}

function showServerCrashDialog(exitCode: number | null): void {
  dialog.showMessageBox({
    type: 'error',
    title: 'Server Error',
    message: 'The Cradle server has stopped unexpectedly.',
    detail: `Exit code: ${exitCode}\nThe app may not function correctly. Please restart the application.`,
    buttons: ['Restart App', 'Close'],
  }).then(({ response }) => {
    if (response === 0) {
      app.relaunch()
      app.exit(0)
    }
  })
}

/**
 * Stop the server process.
 */
export async function stopServer(timeoutMs = 5_000): Promise<void> {
  const child = serverProcess
  if (!child) {
    await stopLocatedServer(timeoutMs)
    return
  }

  isServerShutdownRequested = true
  serverProcess = null
  locatedServerPid = null
  removeCliServerLocator()

  await new Promise<void>((resolveStop) => {
    let resolved = false
    let forceTimer: NodeJS.Timeout | null = null

    const finish = () => {
      if (resolved) {
        return
      }
      resolved = true
      if (forceTimer) {
        clearTimeout(forceTimer)
      }
      resolveStop()
    }

    child.once('exit', finish)
    child.once('error', finish)

    if (child.exitCode !== null || child.signalCode !== null) {
      finish()
      return
    }

    child.kill('SIGTERM')
    forceTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
      }
      finish()
    }, timeoutMs)
  })
}

async function stopLocatedServer(timeoutMs: number): Promise<void> {
  const pid = locatedServerPid
  locatedServerPid = null
  if (!pid) {
    removeCliServerLocator()
    return
  }

  try {
    process.kill(pid, 'SIGTERM')
  }
  catch {
    // The located server may have already exited.
    removeCliServerLocator()
    return
  }

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    }
    catch {
      removeCliServerLocator()
      return
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  try {
    process.kill(pid, 'SIGKILL')
  }
  catch {
    // The located server may have exited after the timeout check.
  }
  removeCliServerLocator()
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/health`)
      if (res.ok) {
        return
      }
    }
    catch {
      // Server not ready yet
    }
    await new Promise(r => setTimeout(r, 200))
  }
  throw createServerStartupError(url, timeoutMs)
}
