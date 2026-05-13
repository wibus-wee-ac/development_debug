// Input: child_process fork, get-port, tsx runner
// Output: Starts the Cradle server as a child process
// Position: apps/desktop/src/main/server-process.ts

import type { ChildProcess } from 'node:child_process'
import { fork } from 'node:child_process'
import { join } from 'node:path'

import { app, dialog } from 'electron'
import getPort from 'get-port'

let serverProcess: ChildProcess | null = null
let restartCount = 0
const MAX_RESTARTS = 3
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

  await spawnServer({ host, port, dataDir })

  // Wait for server to be ready
  await waitForServer(currentServerUrl, 15_000)

  console.log(`[desktop] Server started on ${currentServerUrl}`)
  return currentServerUrl
}

async function spawnServer(opts: { host: string, port: number, dataDir: string }): Promise<void> {
  const { host, port, dataDir } = opts

  // In dev, use tsx to run the TS source directly
  // In production, run the compiled server entry
  const isDev = !!process.env.ELECTRON_RENDERER_URL
  const serverEntry = isDev
    ? join(__dirname, '../../../../apps/server/src/index.ts')
    : join(process.resourcesPath, 'server/main.js')

  const execArgv = isDev ? ['--import', 'tsx'] : []

  serverProcess = fork(serverEntry, [], {
    env: {
      ...process.env,
      CRADLE_HOST: host,
      CRADLE_PORT: String(port),
      CRADLE_DATA_DIR: dataDir,
      NODE_ENV: isDev ? 'development' : 'production',
    },
    execArgv,
    stdio: 'pipe',
  })

  serverProcess.stdout?.on('data', (data: Buffer) => {
    console.log(`[server] ${data.toString().trim()}`)
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
      console.log(`[desktop] Restarting server (attempt ${restartCount}/${MAX_RESTARTS})...`)
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
