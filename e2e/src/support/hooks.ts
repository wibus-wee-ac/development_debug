// Input: Cucumber scenario lifecycle, CradleWorld launch hooks, and filesystem artifact persistence helpers
// Output: Global E2E hooks that launch Electron, collect trace/screenshot evidence, and clean up scenario state
// Position: Cross-scenario lifecycle orchestration for the E2E support layer

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import type { ITestCaseHookParameter } from '@cucumber/cucumber'
import { After, Before, setDefaultTimeout, Status } from '@cucumber/cucumber'

import type { CradleWorld } from './world.ts'

setDefaultTimeout(60_000)

Before({ timeout: 60_000 }, async function (this: CradleWorld, scenario: ITestCaseHookParameter) {
  this.prepareScenario(scenario.pickle.name)
  await this.launch()

  this.page.on('console', (msg) => {
    this.pushConsoleMessage(`[console:${msg.type()}] ${msg.text()}`)
  })
  this.page.on('pageerror', (error) => {
    this.pushConsoleMessage(`[pageerror] ${error.message}\n${error.stack ?? ''}`)
  })

  await this.page.context().tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
  })
})

After(async function (this: CradleWorld, scenario: ITestCaseHookParameter) {
  const failed = scenario.result?.status === Status.FAILED
  const artifacts = this.scenarioArtifacts

  if (artifacts) {
    mkdirSync(artifacts.scenarioDir, { recursive: true })
  }

  if (failed && this.page && artifacts) {
    await this.page.screenshot({ path: artifacts.screenshotPath, fullPage: true })
    await this.page.context().tracing.stop({ path: artifacts.tracePath })

    const consoleSections = [
      `# Scenario\n${this.scenarioName}`,
      `\n# Renderer console\n${this.consoleMessages.join('\n') || '(no renderer console output)'}`,
      `\n# Mock LLM requests\n${JSON.stringify(this.mockLlmServer?.getRequestLog() ?? [], null, 2)}`,
    ]
    writeFileSync(artifacts.consoleLogPath, consoleSections.join('\n'), 'utf8')

    await this.attach(readFileSync(artifacts.screenshotPath), 'image/png')
    await this.attach(readFileSync(artifacts.tracePath), 'application/zip')
    await this.attach(readFileSync(artifacts.consoleLogPath), 'text/plain')
  }
  else if (this.page) {
    await this.page.context().tracing.stop()
  }

  await this.close()
})
