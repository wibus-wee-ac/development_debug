// Input: vi mocks for electron, fs, tar, extract-zip, DB
// Output: Unit tests for acp-installer path safety, install, uninstall
// Position: Unit test file for src/main/lib/acp-installer.ts

import { describe, expect, it, vi } from 'vitest'

import { getAgentInstallDir, installPackageAgent, uninstallBinaryAgent } from '../acp-installer'
import type { RegistryAgent } from '../acp-registry'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  net: {
    request: vi.fn(),
  },
}))

const mockDbRun = vi.fn()
const mockDbValues = vi.fn(() => ({ run: mockDbRun }))
const mockDbInsert = vi.fn(() => ({ values: mockDbValues }))

vi.mock('../../db', () => ({
  getDb: vi.fn(() => ({
    insert: mockDbInsert,
  })),
}))

vi.mock('../../db/schema', () => ({
  acpAgents: { id: 'id' },
  acpAuditLog: {},
}))

vi.mock('tar', () => ({
  extract: vi.fn(),
}))

vi.mock('extract-zip', () => ({
  default: vi.fn(),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<RegistryAgent> = {}): RegistryAgent {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    version: '1.0.0',
    description: 'A test agent',
    distribution: {
      npx: { package: '@test/agent', args: ['--stdio'] },
      uvx: { package: 'test-agent', args: [] },
    },
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getAgentInstallDir', () => {
  it('returns correct path for valid agent ID', () => {
    const result = getAgentInstallDir('/Users/test/Library/Application Support/Cradle', 'my-agent')
    expect(result).toMatch(/acp[/\\]agents[/\\]my-agent$/)
  })

  it('throws on unsafe agent ID with path traversal', () => {
    expect(() => getAgentInstallDir('/tmp', '../escape')).toThrow('Unsafe agent ID')
  })

  it('throws on agent ID with uppercase', () => {
    expect(() => getAgentInstallDir('/tmp', 'BadAgent')).toThrow('Unsafe agent ID')
  })

  it('throws on agent ID with spaces', () => {
    expect(() => getAgentInstallDir('/tmp', 'bad agent')).toThrow('Unsafe agent ID')
  })

  it('throws on empty agent ID', () => {
    expect(() => getAgentInstallDir('/tmp', '')).toThrow('Unsafe agent ID')
  })

  it('throws on agent ID starting with a number', () => {
    expect(() => getAgentInstallDir('/tmp', '1agent')).toThrow('Unsafe agent ID')
  })

  it('accepts valid agent IDs', () => {
    expect(() => getAgentInstallDir('/tmp', 'my-cool-agent')).not.toThrow()
    expect(() => getAgentInstallDir('/tmp', 'agent99')).not.toThrow()
    expect(() => getAgentInstallDir('/tmp', 'a')).not.toThrow()
  })
})

describe('installPackageAgent', () => {
  it('returns correct result for npx distribution', () => {
    const agent = makeAgent()
    const result = installPackageAgent(agent, 'npx')

    expect(result).toEqual({
      installPath: null,
      cmd: '@test/agent',
      args: ['--stdio'],
      env: {},
    })
  })

  it('returns correct result for uvx distribution', () => {
    const agent = makeAgent()
    const result = installPackageAgent(agent, 'uvx')

    expect(result).toEqual({
      installPath: null,
      cmd: 'test-agent',
      args: [],
      env: {},
    })
  })

  it('throws when distribution type is not available', () => {
    const agent = makeAgent({ distribution: {} })
    expect(() => installPackageAgent(agent, 'npx')).toThrow('No npx distribution found')
  })

  it('includes env vars when specified', () => {
    const agent = makeAgent({
      distribution: {
        npx: { package: '@test/agent', env: { NODE_ENV: 'production' } },
      },
    })
    const result = installPackageAgent(agent, 'npx')
    expect(result.env).toEqual({ NODE_ENV: 'production' })
  })
})

describe('uninstallBinaryAgent', () => {
  it('throws when install path is outside userData/acp/agents/', async () => {
    await expect(
      uninstallBinaryAgent('test', '/etc/passwd', '/Users/test/Library/Cradle'),
    ).rejects.toThrow('Refusing to delete path outside of userData/acp/agents')
  })

  it('throws on path traversal in install path', async () => {
    const userData = '/Users/test/Library/Cradle'
    const maliciousPath = `${userData}/acp/agents/../../important-data`
    await expect(
      uninstallBinaryAgent('test', maliciousPath, userData),
    ).rejects.toThrow('Refusing to delete')
  })
})
