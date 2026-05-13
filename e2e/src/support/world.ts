// Input: Cucumber World base, Playwright browser launcher, mock LLM server helpers
// Output: CradleWorld test harness exposing browser/page handles and server API wrappers
// Position: Shared end-to-end support world used by all Cucumber features and step definitions

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { IWorldOptions } from '@cucumber/cucumber'
import { setWorldConstructor, World } from '@cucumber/cucumber'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { chromium } from '@playwright/test'

import type { MockLlmFailureMode, MockToolCall } from './mock-llm-server'
import { MockLlmServer } from './mock-llm-server'
import { getManagedServerUrl, getManagedWebUrl } from './server-lifecycle'
import type { ScenarioArtifactPaths } from './world-utils'
import {
  buildScenarioArtifactPaths,
} from './world-utils'

// ── World parameters (from cucumber.mjs worldParameters) ─────────────────────

interface WorldParameters {
  webUrl: string
  serverUrl: string
}

// ── Custom world ──────────────────────────────────────────────────────────────

export class CradleWorld extends World {
  private static scenarioCounter = 0

  browser!: Browser
  context!: BrowserContext
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
    const base = this.parameters as WorldParameters
    const managedServerUrl = getManagedServerUrl()
    const managedWebUrl = getManagedWebUrl()
    return {
      ...base,
      ...(managedServerUrl ? { serverUrl: managedServerUrl } : {}),
      ...(managedWebUrl ? { webUrl: managedWebUrl } : {}),
    }
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

    const response = await fetch(`${this.params.serverUrl}/profiles/mock-llm-profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Mock LLM',
        providerKind: 'openai-compatible',
        enabled: true,
        config: {
          baseUrl: this.mockLlmBaseUrl,
          model: 'mock-model',
          apiMode: 'responses',
        },
        credentialRef: null,
      }),
    })
    if (!response.ok) {
      throw new Error(`Failed to configure mock LLM provider: ${response.status} ${await response.text()}`)
    }
  }

  async launch(): Promise<void> {
    // Reset server state for clean test isolation
    const resetResponse = await fetch(`${this.params.serverUrl}/test/reset`, { method: 'POST' })
    if (!resetResponse.ok) {
      throw new Error(`Failed to reset server state: ${resetResponse.status} ${await resetResponse.text()}`)
    }

    // Launch browser
    this.browser = await chromium.launch({ headless: !process.env.CRADLE_E2E_HEADED })
    this.context = await this.browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
    })
    this.page = await this.context.newPage()
    await this.page.goto(this.params.webUrl)
    await this.page.waitForLoadState('domcontentloaded')
  }

  async close(): Promise<void> {
    if (this.mockLlmServer) {
      await this.mockLlmServer.stop()
      this.mockLlmServer = null
      this.mockLlmBaseUrl = ''
    }
    await this.context?.close()
    await this.browser?.close()
  }

  /**
   * @deprecated mainProcess() is not available in web mode. Use page.evaluate() or server API instead.
   */

  async mainProcess<T = unknown>(_fn: unknown, _arg?: unknown): Promise<T> {
    throw new Error('mainProcess() is not available in web mode. Use page.evaluate() or server API instead.')
  }
}

setWorldConstructor(CradleWorld)
