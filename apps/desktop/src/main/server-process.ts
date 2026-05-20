// Input: child_process fork, get-port, tsx runner, and development Node executable
// Output: Starts the Cradle server as a child process with desktop-owned runtime environment
// Position: apps/desktop/src/main/server-process.ts

import type { ChildProcess } from 'node:child_process'
import { fork } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { app, dialog } from 'electron'
import getPort from 'get-port'

import { getPluginEnvVars } from './plugin-loader'

let serverProcess: ChildProcess | null = null
let restartCount = 0
const MAX_RESTARTS = 3
const CREDENTIAL_SECRET_FILE = 'credential-secret'
const SAFE_STORAGE_PREFIX = 'v1-safe:'
const PLAIN_STORAGE_PREFIX = 'v1-plain:'
const KEYCHAIN_BACKUP_SUFFIX = '.keychain-backup'
let currentServerUrl = ''

/**
 * Start the Cradle server as a forked child process.
 * Returns the full URL the server is listening on.
 */
export async function startServer(): Promise<string> {
  const port = await getPort({ port: [21423, 21424, 21425, 21426] })
  const host = '127.0.0.1'
  currentServerUrl = `http://${host}:${port}`

  const dataDir = join(app.getPath('userData'), 'data')
  const credentialSecret = resolveDesktopCredentialSecret(dataDir)

  await spawnServer({ host, port, dataDir, credentialSecret })

  // Wait for server to be ready
  await waitForServer(currentServerUrl, 15_000)

  console.warn(`[desktop] Server started on ${currentServerUrl}`)
  return currentServerUrl
}

async function spawnServer(opts: { host: string, port: number, dataDir: string, credentialSecret: string }): Promise<void> {
  const { host, port, dataDir, credentialSecret } = opts

  // In dev, use tsx to run the TS source directly
  // In production, run the compiled server entry
  const isDev = !!process.env.ELECTRON_RENDERER_URL
  const serverEntry = isDev
    ? join(__dirname, '../../../../apps/server/src/index.ts')
    : join(process.resourcesPath, 'server/main.js')

  const execArgv = isDev ? ['--import', 'tsx'] : []
  const execPath = isDev ? resolveDevNodeExecPath() : undefined

  serverProcess = fork(serverEntry, [], {
    env: {
      ...process.env,
      ...getPluginEnvVars(),
      CRADLE_HOST: host,
      CRADLE_PORT: String(port),
      CRADLE_DATA_DIR: dataDir,
      CRADLE_CREDENTIAL_SECRET: credentialSecret,
      NODE_ENV: isDev ? 'development' : 'production',
    },
    execPath,
    execArgv,
    stdio: 'pipe',
  })

  serverProcess.stdout?.on('data', (data: Buffer) => {
    console.warn(`[server] ${data.toString().trim()}`)
  })

  serverProcess.stderr?.on('data', (data: Buffer) => {
    console.error(`[server] ${data.toString().trim()}`)
  })

  serverProcess.on('exit', (code, signal) => {
    if (signal === 'SIGTERM' || signal === 'SIGKILL') {
      // Intentional shutdown
      return
    }

    console.error(`[desktop] Server process exited unexpectedly (code=${code}, signal=${signal})`)

    if (restartCount < MAX_RESTARTS) {
      restartCount++
      console.warn(`[desktop] Restarting server (attempt ${restartCount}/${MAX_RESTARTS})...`)
      spawnServer(opts).then(() => waitForServer(currentServerUrl, 10_000)).catch((err) => {
        console.error('[desktop] Server restart failed:', err)
        showServerCrashDialog(code)
      })
    }
    else {
      showServerCrashDialog(code)
    }
  })
}

function resolveDevNodeExecPath(): string {
  return process.env.npm_node_execpath
    ?? process.env.NODE
    ?? 'node'
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
export function stopServer(): void {
  if (serverProcess) {
    serverProcess.kill('SIGTERM')
    serverProcess = null
  }
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
  throw new Error(`Server failed to start within ${timeoutMs}ms`)
}
