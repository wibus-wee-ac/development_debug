import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { IWorldOptions } from '@cucumber/cucumber'
import { setWorldConstructor, World } from '@cucumber/cucumber'
import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from '@playwright/test'

// ── World parameters (from cucumber.mjs worldParameters) ─────────────────────

interface WorldParameters {
  appPath: string
  appArgs?: string[]
}

// ── Custom world ──────────────────────────────────────────────────────────────

export class CradleWorld extends World {
  app!: ElectronApplication
  page!: Page

  constructor(options: IWorldOptions) {
    super(options)
  }

  get params(): WorldParameters {
    return this.parameters as WorldParameters
  }

  /** Returns the isolated userData path used during E2E tests. */
  static get e2eUserDataPath(): string {
    const platform = process.platform
    const name = 'cradle-e2e'
    if (platform === 'darwin') {
      return join(homedir(), 'Library', 'Application Support', name)
    }
    if (platform === 'win32') {
      return join(process.env.APPDATA ?? homedir(), name)
    }
    return join(homedir(), '.config', name)
  }

  async launch(): Promise<void> {
    const userDataPath = CradleWorld.e2eUserDataPath
    if (!existsSync(userDataPath)) {
      mkdirSync(userDataPath, { recursive: true })
    }

    // Delete the database before each test to ensure a clean slate
    const dbPath = join(userDataPath, 'cradle.db')
    if (existsSync(dbPath)) {
      rmSync(dbPath)
    }

    this.app = await electron.launch({
      args: [
        this.params.appPath,
        ...(this.params.appArgs ?? []),
        // Override userData so tests don't pollute the real profile
        `--user-data-dir=${userDataPath}`,
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    })

    // Grab the first renderer window
    this.page = await this.app.firstWindow()
    // Ensure the window is fully loaded before steps run
    await this.page.waitForLoadState('domcontentloaded')
  }

  async close(): Promise<void> {
    await this.app?.close()
  }

  /**
   * Evaluates a function inside the Electron main process.
   * The first argument exposed to `fn` is the result of `require('electron')`.
   */
  // eslint-disable-next-line ts/no-explicit-any
  async mainProcess<T = unknown>(fn: (electron: any) => T | Promise<T>): Promise<T> {
    return this.app.evaluate(fn) as Promise<T>
  }
}

setWorldConstructor(CradleWorld)
