// Input: E2E server lifecycle management
// Output: Start/stop isolated server + web app instances for E2E tests
// Position: e2e/src/support — global hooks for test infrastructure

import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { AfterAll, BeforeAll } from '@cucumber/cucumber'

const ROOT = resolve(__dirname, '..', '..', '..')

interface E2EServerInstance {
  serverProcess: ChildProcess
  dataDir: string
  serverUrl: string
}

let instance: E2EServerInstance | null = null

/** Exported so CradleWorld can override its serverUrl. */
export function getManagedServerUrl(): string | null {
  return instance?.serverUrl ?? null
}

async function waitForReady(url: string, label: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) {
        return
      }
    }
    catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`${label} did not become ready at ${url} within ${timeoutMs}ms`)
}

/**
 * If CRADLE_SERVER_URL is set, we assume the user is managing the server themselves.
 * Otherwise, we start an isolated server with a temp data directory.
 */
BeforeAll({ timeout: 60_000 }, async () => {
  // If user explicitly provides a server URL, don't start a managed server
  if (process.env.CRADLE_SERVER_URL) {
    return
  }

  const dataDir = mkdtempSync(join(tmpdir(), 'cradle-e2e-data-'))
  // Use a random port to avoid conflicts with dev server
  const serverPort = 21400 + Math.floor(Math.random() * 99)

  const serverProcess = spawn('npx', ['vite-node', 'src/index.ts'], {
    cwd: join(ROOT, 'apps', 'server'),
    env: {
      ...process.env,
      CRADLE_DATA_DIR: dataDir,
      CRADLE_PORT: String(serverPort),
      CRADLE_HOST: '127.0.0.1',
      CRADLE_CREDENTIAL_SECRET: 'e2e-test-secret',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  serverProcess.stdout?.on('data', (chunk: Buffer) => {
    if (process.env.CRADLE_E2E_VERBOSE) {
      process.stderr.write(`[server] ${chunk.toString()}`)
    }
  })
  serverProcess.stderr?.on('data', (chunk: Buffer) => {
    if (process.env.CRADLE_E2E_VERBOSE) {
      process.stderr.write(`[server:err] ${chunk.toString()}`)
    }
  })

  const serverUrl = `http://127.0.0.1:${serverPort}`
  await waitForReady(`${serverUrl}/health`, 'Managed E2E Server')

  instance = { serverProcess, dataDir, serverUrl }
  // eslint-disable-next-line no-console
  console.log(`[e2e] Managed server started at ${serverUrl} (data: ${dataDir})`)
})

AfterAll({ timeout: 15_000 }, async () => {
  if (!instance) {
    return
  }

  const { serverProcess, dataDir } = instance

  serverProcess.kill('SIGTERM')

  await new Promise<void>((resolve) => {
    serverProcess.on('exit', () => resolve())
    setTimeout(() => {
      serverProcess.kill('SIGKILL')
      resolve()
    }, 5000)
  })

  try {
    rmSync(dataDir, { recursive: true, force: true })
  }
  catch { /* best effort */ }

  instance = null
})
