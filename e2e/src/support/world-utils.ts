// Input: Cucumber scenario names and process environment values
// Output: Deterministic helpers for scenario-safe artifact names and test-only launch env
// Position: Shared pure utilities for E2E world/hooks without direct Playwright coupling

import { join } from 'node:path'

export interface ScenarioArtifactPaths {
  slug: string
  scenarioDir: string
  screenshotPath: string
  tracePath: string
  consoleLogPath: string
}

export function slugifyScenarioName(name: string): string {
  const collapsed = name.trim().toLowerCase().replace(/\s+/g, '-')
  const safe = collapsed.replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-')
  const finalValue = safe.replace(/^-+|-+$/g, '')
  return finalValue || 'unnamed-scenario'
}

export function buildE2ELaunchEnv(baseEnv: NodeJS.ProcessEnv, homePath: string): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    NODE_ENV: 'test',
    CRADLE_E2E_NO_ACTIVATE: '1',
    HOME: homePath,
    USERPROFILE: homePath,
  }
}

export function buildScenarioArtifactPaths(
  artifactsRoot: string,
  scenarioName: string,
  caseIndex: number,
): ScenarioArtifactPaths {
  const slug = slugifyScenarioName(scenarioName)
  const scenarioDir = join(artifactsRoot, 'scenarios', `${slug}-${caseIndex}`)
  return {
    slug,
    scenarioDir,
    screenshotPath: join(scenarioDir, 'failure.png'),
    tracePath: join(scenarioDir, 'trace.zip'),
    consoleLogPath: join(scenarioDir, 'console.log'),
  }
}
