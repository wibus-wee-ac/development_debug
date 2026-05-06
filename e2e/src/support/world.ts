// Input: Cucumber World base, Playwright Electron launcher, filesystem sandbox helpers
// Output: CradleWorld test harness exposing Electron app/page handles plus isolated HOME and userData paths
// Position: Shared end-to-end support world used by all Cucumber features and step definitions

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import type { IWorldOptions } from '@cucumber/cucumber'
import { setWorldConstructor, World } from '@cucumber/cucumber'
import type { ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from '@playwright/test'

import { MockLlmServer, type MockLlmFailureMode, type MockToolCall } from './mock-llm-server'
import {
  buildE2ELaunchEnv,
  buildScenarioArtifactPaths,
  type ScenarioArtifactPaths,
} from './world-utils'

// ── World parameters (from cucumber.mjs worldParameters) ─────────────────────

interface WorldParameters {
  appPath: string
  appArgs?: string[]
}

// ── Custom world ──────────────────────────────────────────────────────────────

export class CradleWorld extends World {
  private static scenarioCounter = 0

  app!: ElectronApplication
  page!: Page
  skillWorkspaceDir?: string
  skillImportSourceDir?: string
  skillExportDir?: string
  skillAgentIds: Record<string, string> = {}
  scenarioArtifacts: ScenarioArtifactPaths | null = null
  scenarioName = ''
  consoleMessages: string[] = []
  mockLlmServer: MockLlmServer | null = null
  mockLlmBaseUrl = ''
  private readonly scenarioState = new Map<string, unknown>()

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

  static get e2eHomePath(): string {
    return join(CradleWorld.e2eUserDataPath, 'home')
  }

  static nextScenarioIndex(): number {
    CradleWorld.scenarioCounter += 1
    return CradleWorld.scenarioCounter
  }

  prepareScenario(name: string, artifactsRoot = join(process.cwd(), 'e2e', 'artifacts')): void {
    this.scenarioName = name
    this.consoleMessages = []
    this.scenarioState.clear()
    this.scenarioArtifacts = buildScenarioArtifactPaths(
      artifactsRoot,
      name,
      CradleWorld.nextScenarioIndex(),
    )
  }

  remember<T>(key: string, value: T): void {
    this.scenarioState.set(key, value)
  }

  recall<T>(key: string): T {
    if (!this.scenarioState.has(key)) {
      throw new Error(`Missing scenario state: ${key}`)
    }
    return this.scenarioState.get(key) as T
  }

  maybeRecall<T>(key: string): T | undefined {
    return this.scenarioState.get(key) as T | undefined
  }

  createTempWorkspaceDir(prefix = 'cradle-e2e-ws-'): string {
    return mkdtempSync(join(tmpdir(), prefix))
  }

  pushConsoleMessage(message: string): void {
    this.consoleMessages.push(message)
  }

  async configureMockLlmProvider(options: {
    responseText?: string
    responseTexts?: string[]
    reasoningText?: string
    toolCalls?: MockToolCall[]
    chunkDelay?: number
    failureMode?: MockLlmFailureMode
    errorStatusCode?: number
    errorMessage?: string
  } = {}): Promise<void> {
    if (this.mockLlmServer) {
      await this.mockLlmServer.stop()
    }

    this.mockLlmServer = new MockLlmServer(options)
    this.mockLlmBaseUrl = await this.mockLlmServer.start()

    await this.page.evaluate(async ({ baseUrl }) => {
      // eslint-disable-next-line ts/no-explicit-any
      const ipcRenderer = (window as any).electron?.ipcRenderer
      if (!ipcRenderer?.invoke) {
        throw new Error('electron.ipcRenderer not available')
      }

      await ipcRenderer.invoke('agentRuntime.upsertProfile', {
        id: 'mock-llm-profile',
        name: 'Mock LLM',
        providerKind: 'openai-compatible',
        enabled: true,
        configJson: JSON.stringify({
          baseUrl,
          model: 'mock-model',
        }),
        credentialRef: null,
      })
    }, { baseUrl: this.mockLlmBaseUrl })
  }

  async launch(): Promise<void> {
    const userDataPath = CradleWorld.e2eUserDataPath
    const homePath = CradleWorld.e2eHomePath
    // Wipe entire userData to clear DB, localStorage, and persisted store state
    if (existsSync(userDataPath)) {
      rmSync(userDataPath, { recursive: true })
    }
    mkdirSync(userDataPath, { recursive: true })
    mkdirSync(homePath, { recursive: true })

    this.app = await electron.launch({
      args: [
        this.params.appPath,
        ...(this.params.appArgs ?? []),
        // Override userData so tests don't pollute the real profile
        `--user-data-dir=${userDataPath}`,
      ],
      env: buildE2ELaunchEnv(
        Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        ),
        homePath,
      ),
    })

    // Grab the first renderer window
    this.page = await this.app.firstWindow()
    // Ensure the window is fully loaded before steps run
    await this.page.waitForLoadState('domcontentloaded')
  }

  async close(): Promise<void> {
    if (this.mockLlmServer) {
      await this.mockLlmServer.stop()
      this.mockLlmServer = null
      this.mockLlmBaseUrl = ''
    }

    await this.app?.close()
  }

  /**
   * Evaluates a function inside the Electron main process.
   * The first argument exposed to `fn` is the result of `require('electron')`.
   */
  // eslint-disable-next-line ts/no-explicit-any
  async mainProcess<T = unknown, A = undefined>(
    fn: (electron: any, arg: A) => T | Promise<T>,
    arg?: A,
  ): Promise<T> {
    return this.app.evaluate(fn as never, arg as never) as Promise<T>
  }
}

setWorldConstructor(CradleWorld)
