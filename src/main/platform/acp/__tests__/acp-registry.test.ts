// Input: vi mocks for electron.net, acp-registry module
// Output: Unit tests for getPlatformKey, getSupportedDistributionTypes, fetchRegistry
// Position: Unit test file for src/main/platform/acp/acp-registry.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RegistryAgent } from '../acp-registry'
import { fetchRegistry, getPlatformKey, getSupportedDistributionTypes, REGISTRY_URL } from '../acp-registry'

// ── Mock electron ─────────────────────────────────────────────────────────────

const mockRequest = {
  on: vi.fn(),
  end: vi.fn(),
}

vi.mock('electron', () => ({
  net: {
    request: vi.fn(() => mockRequest),
  },
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<RegistryAgent> = {}): RegistryAgent {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    version: '1.0.0',
    description: 'A test agent',
    distribution: {
      binary: {
        'darwin-aarch64': { archive: 'https://example.com/agent.tar.gz', cmd: './agent' },
      },
      npx: { package: '@test/agent' },
    },
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getPlatformKey', () => {
  const originalPlatform = process.platform
  const originalArch = process.arch

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    Object.defineProperty(process, 'arch', { value: originalArch })
  })

  it('returns darwin-aarch64 for darwin/arm64', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    Object.defineProperty(process, 'arch', { value: 'arm64' })
    expect(getPlatformKey()).toBe('darwin-aarch64')
  })

  it('returns darwin-x86_64 for darwin/x64', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    Object.defineProperty(process, 'arch', { value: 'x64' })
    expect(getPlatformKey()).toBe('darwin-x86_64')
  })

  it('returns linux-x86_64 for linux/x64', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    Object.defineProperty(process, 'arch', { value: 'x64' })
    expect(getPlatformKey()).toBe('linux-x86_64')
  })

  it('returns windows-x86_64 for win32/x64', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    Object.defineProperty(process, 'arch', { value: 'x64' })
    expect(getPlatformKey()).toBe('windows-x86_64')
  })

  it('returns null for unsupported platform', () => {
    Object.defineProperty(process, 'platform', { value: 'freebsd' })
    Object.defineProperty(process, 'arch', { value: 'x64' })
    expect(getPlatformKey()).toBeNull()
  })
})

describe('getSupportedDistributionTypes', () => {
  const originalPlatform = process.platform
  const originalArch = process.arch

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    Object.defineProperty(process, 'arch', { value: 'arm64' })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
    Object.defineProperty(process, 'arch', { value: originalArch })
  })

  it('returns binary and npx when both are available', () => {
    const agent = makeAgent()
    expect(getSupportedDistributionTypes(agent)).toEqual(['binary', 'npx'])
  })

  it('returns only npx when no binary for current platform', () => {
    const agent = makeAgent({
      distribution: { binary: { 'linux-x86_64': { archive: 'https://x.com/a.tar.gz', cmd: './a' } }, npx: { package: '@test/a' } },
    })
    // darwin-aarch64 not in binary
    expect(getSupportedDistributionTypes(agent)).toEqual(['npx'])
  })

  it('returns all three when binary, npx, and uvx are present', () => {
    const agent = makeAgent({
      distribution: {
        binary: { 'darwin-aarch64': { archive: 'https://x.com/a.tar.gz', cmd: './a' } },
        npx: { package: '@test/a' },
        uvx: { package: 'test-a' },
      },
    })
    expect(getSupportedDistributionTypes(agent)).toEqual(['binary', 'npx', 'uvx'])
  })

  it('returns empty when no distributions match', () => {
    const agent = makeAgent({
      distribution: {},
    })
    expect(getSupportedDistributionTypes(agent)).toEqual([])
  })
})

describe('fetchRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequest.on.mockReset()
    mockRequest.end.mockReset()
  })

  it('fetches and parses JSON from the CDN', async () => {
    const registryPayload = { version: '1', agents: [{ id: 'a1' }] }
    const buf = Buffer.from(JSON.stringify(registryPayload))

    mockRequest.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'response') {
        // Simulate a successful response
        const fakeResponse = {
          statusCode: 200,
          on: vi.fn((evt: string, handler: (...args: unknown[]) => void) => {
            if (evt === 'data') {
              handler(buf)
            }
            if (evt === 'end') {
              handler()
            }
          }),
        }
        cb(fakeResponse)
      }
      return mockRequest
    })

    const result = await fetchRegistry()
    expect(result).toEqual(registryPayload)
  })

  it('rejects on non-200 status', async () => {
    mockRequest.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'response') {
        cb({ statusCode: 404, on: vi.fn() })
      }
      return mockRequest
    })

    await expect(fetchRegistry()).rejects.toThrow('Registry fetch failed with HTTP 404')
  })

  it('rejects on network error', async () => {
    mockRequest.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'error') {
        cb(new Error('ECONNREFUSED'))
      }
      return mockRequest
    })

    await expect(fetchRegistry()).rejects.toThrow('ECONNREFUSED')
  })

  it('uses the correct registry URL', () => {
    expect(REGISTRY_URL).toBe('https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json')
  })
})
