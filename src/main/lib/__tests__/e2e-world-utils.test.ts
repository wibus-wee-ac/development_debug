// Input: E2E world utility functions from support layer
// Output: Contract tests for scenario artifact path generation and launch env defaults
// Position: Main test suite validating deterministic E2E infrastructure behavior

import { describe, expect, it } from 'vitest'

import {
  buildE2ELaunchEnv,
  buildScenarioArtifactPaths,
  slugifyScenarioName,
} from '../../../../e2e/src/support/world-utils'

describe('e2eWorldUtils', () => {
  it('normalizes scenario names into stable slugs', () => {
    expect(slugifyScenarioName('  Agent/LLM: 聊天 错误恢复  ')).toBe('agent-llm')
    expect(slugifyScenarioName('。。。')).toBe('unnamed-scenario')
  })

  it('builds screenshot/trace/console paths under artifacts root', () => {
    const paths = buildScenarioArtifactPaths('/tmp/e2e-artifacts', 'Chat: sends and recovers', 2)
    expect(paths.slug).toBe('chat-sends-and-recovers')
    expect(paths.scenarioDir).toBe('/tmp/e2e-artifacts/scenarios/chat-sends-and-recovers-2')
    expect(paths.screenshotPath).toBe('/tmp/e2e-artifacts/scenarios/chat-sends-and-recovers-2/failure.png')
    expect(paths.tracePath).toBe('/tmp/e2e-artifacts/scenarios/chat-sends-and-recovers-2/trace.zip')
    expect(paths.consoleLogPath).toBe('/tmp/e2e-artifacts/scenarios/chat-sends-and-recovers-2/console.log')
  })

  it('injects no-activate defaults into launch environment', () => {
    const env = buildE2ELaunchEnv({ PATH: '/bin' }, '/tmp/cradle-e2e-home')
    expect(env.NODE_ENV).toBe('test')
    expect(env.CRADLE_E2E_NO_ACTIVATE).toBe('1')
    expect(env.HOME).toBe('/tmp/cradle-e2e-home')
    expect(env.USERPROFILE).toBe('/tmp/cradle-e2e-home')
  })
})
