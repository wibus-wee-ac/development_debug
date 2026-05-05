// Input: Cucumber scenario names and process environment values
// Output: Deterministic helpers for scenario-safe artifact names and hidden-window E2E launch env
// Position: Shared pure utilities for E2E world/hooks without direct Playwright coupling

import { join } from 'node:path'

const WHITESPACE_RE = /\s+/g
const NON_SLUG_CHAR_RE = /[^a-z0-9-_]/g
const DUPLICATE_DASH_RE = /-+/g
const EDGE_DASH_RE = /^-+|-+$/g

export interface ScenarioArtifactPaths {
  slug: string
  scenarioDir: string
  screenshotPath: string
  tracePath: string
  consoleLogPath: string
}

export function slugifyScenarioName(name: string): string {
  const collapsed = name.trim().toLowerCase().replace(WHITESPACE_RE, '-')
  const safe = collapsed.replace(NON_SLUG_CHAR_RE, '-').replace(DUPLICATE_DASH_RE, '-')
  const finalValue = safe.replace(EDGE_DASH_RE, '')
  return finalValue || 'unnamed-scenario'
}

export function buildE2ELaunchEnv(baseEnv: NodeJS.ProcessEnv, homePath: string): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    NODE_ENV: 'test',
    CRADLE_E2E_HIDE_WINDOWS: '1',
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
