// Input: main-process Drizzle schema exports
// Output: Unit tests that lock the destructive Agent Runtime schema direction
// Position: Schema regression tests for unified agent profile persistence

import { describe, expect, it } from 'vitest'

import * as schema from '../schema'

describe('agent runtime schema', () => {
  it('exports unified agent runtime tables', () => {
    expect(schema.agentProfiles).toBeDefined()
    expect(schema.agentCredentials).toBeDefined()
    expect(schema.runtimeAuditLog).toBeDefined()
  })

  it('exports ACP agent tables', () => {
    expect(schema.acpAgents).toBeDefined()
    expect(schema.acpAuditLog).toBeDefined()
  })

  it('does not export legacy CLI agent tables', () => {
    expect('cliAgents' in schema).toBe(false)
  })

  it('does not export the legacy runtimeSessions table', () => {
    expect('runtimeSessions' in schema).toBe(false)
  })
})
