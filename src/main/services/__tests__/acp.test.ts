// Input: vi mocks for all dependencies (DB, registry, installer, connection manager)
// Output: Unit tests for AcpService methods
// Position: Unit test file for src/main/services/acp.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AcpService } from '../acp'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-userData'),
  },
  ipcMain: {
    handle: vi.fn(),
  },
}))

const mockDbAll = vi.fn().mockReturnValue([])
const mockDbGet = vi.fn().mockReturnValue(undefined)
const mockDbRun = vi.fn()
const mockDbDelete = vi.fn(() => ({
  where: vi.fn(() => ({ run: mockDbRun })),
}))

vi.mock('../db', () => ({
  getDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        orderBy: vi.fn(() => ({ all: mockDbAll })),
        where: vi.fn(() => ({
          get: mockDbGet,
          orderBy: vi.fn(() => ({ all: mockDbAll })),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        run: mockDbRun,
        onConflictDoUpdate: vi.fn(() => ({
          run: mockDbRun,
        })),
      })),
    })),
    delete: mockDbDelete,
  })),
}))

vi.mock('../db/schema', () => ({
  acpAgents: { id: 'id', updatedAt: 'updatedAt' },
  acpAuditLog: { id: 'id', agentId: 'agentId' },
}))

const mockFetchRegistry = vi.fn().mockResolvedValue({ agents: [] })
const mockGetSupportedDistributionTypes = vi.fn().mockReturnValue([])

vi.mock('../lib/acp-registry', () => ({
  fetchRegistry: (...args: unknown[]) => mockFetchRegistry(...args),
  getSupportedDistributionTypes: (...args: unknown[]) => mockGetSupportedDistributionTypes(...args),
  getAgentInstallDir: vi.fn(() => '/tmp/test-userData/acp/agents/test-agent'),
}))

vi.mock('../lib/acp-installer', () => ({
  installBinaryAgent: vi.fn().mockResolvedValue({
    installPath: '/tmp/test-userData/acp/agents/test-agent',
    cmd: './agent',
    args: [],
    env: {},
  }),
  installPackageAgent: vi.fn().mockReturnValue({
    installPath: null,
    cmd: '@test/agent',
    args: [],
    env: {},
  }),
  uninstallBinaryAgent: vi.fn().mockResolvedValue(undefined),
  persistInstalled: vi.fn(),
  persistFailed: vi.fn(),
  getAgentInstallDir: vi.fn(() => '/tmp/test-userData/acp/agents/test-agent'),
}))

const mockConnect = vi.fn().mockResolvedValue({ protocolVersion: '1.0' })
const mockDisconnect = vi.fn().mockResolvedValue(undefined)
const mockIsConnected = vi.fn().mockReturnValue(false)
const mockNewSession = vi.fn().mockResolvedValue({ sessionId: 's1' })
const mockPromptFn = vi.fn().mockResolvedValue({ response: 'ok' })
const mockCancelFn = vi.fn().mockResolvedValue(undefined)

vi.mock('../lib/acp-connection', () => ({
  AcpConnectionManager: {
    getInstance: vi.fn(() => ({
      connect: mockConnect,
      disconnect: mockDisconnect,
      isConnected: mockIsConnected,
      newSession: mockNewSession,
      prompt: mockPromptFn,
      cancel: mockCancelFn,
    })),
  },
}))

const mockGetMetrics = vi.fn().mockReturnValue([])

vi.mock('../lib/acp-process-manager', () => ({
  AcpProcessManager: {
    getInstance: vi.fn(() => ({
      getMetrics: mockGetMetrics,
    })),
  },
}))

// Need to mock AsyncLocalStorage used by @cradle/ipc base
vi.mock('node:async_hooks', () => ({
  AsyncLocalStorage: vi.fn().mockImplementation(() => ({
    getStore: vi.fn(),
    run: vi.fn(),
  })),
}))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('acpService', () => {
  let service: AcpService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new AcpService()
  })

  describe('fetchRegistry', () => {
    it('returns agents from registry', async () => {
      const agents = [{ id: 'a1', name: 'Agent One' }]
      mockFetchRegistry.mockResolvedValueOnce({ agents })

      const result = await service.fetchRegistry()
      expect(result).toEqual(agents)
    })
  })

  describe('getDistributionTypes', () => {
    it('returns empty for unknown agent', async () => {
      mockFetchRegistry.mockResolvedValueOnce({ agents: [] })
      const result = await service.getDistributionTypes('unknown')
      expect(result).toEqual([])
    })

    it('returns distribution types for known agent', async () => {
      const agent = { id: 'test-agent', name: 'Test' }
      mockFetchRegistry.mockResolvedValueOnce({ agents: [agent] })
      mockGetSupportedDistributionTypes.mockReturnValueOnce(['npx', 'uvx'])

      const result = await service.getDistributionTypes('test-agent')
      expect(result).toEqual(['npx', 'uvx'])
    })
  })

  describe('listInstalled', () => {
    it('returns all installed agents', () => {
      const agents = [{ id: 'a1' }, { id: 'a2' }]
      mockDbAll.mockReturnValueOnce(agents)

      const result = service.listInstalled()
      expect(result).toEqual(agents)
    })
  })

  describe('getInstalled', () => {
    it('returns undefined for unknown agent', () => {
      mockDbGet.mockReturnValueOnce(undefined)
      expect(service.getInstalled('unknown')).toBeUndefined()
    })
  })

  describe('getAuditLog', () => {
    it('returns audit entries', () => {
      const entries = [{ id: 1, action: 'install_start' }]
      mockDbAll.mockReturnValueOnce(entries)

      const result = service.getAuditLog()
      expect(result).toEqual(entries)
    })
  })

  describe('getAgentInstallPath', () => {
    it('returns path for agent', () => {
      const result = service.getAgentInstallPath('test-agent')
      expect(result).toContain('test-agent')
    })
  })

  describe('isAgentRunning', () => {
    it('returns false when not running', () => {
      mockIsConnected.mockReturnValueOnce(false)
      expect(service.isAgentRunning('test-agent')).toBe(false)
    })

    it('returns true when running', () => {
      mockIsConnected.mockReturnValueOnce(true)
      expect(service.isAgentRunning('test-agent')).toBe(true)
    })
  })

  describe('startAgent', () => {
    it('throws when agent not installed', async () => {
      mockDbGet.mockReturnValueOnce(undefined)
      await expect(service.startAgent('missing')).rejects.toThrow('not installed')
    })

    it('throws when agent status is not installed', async () => {
      mockDbGet.mockReturnValueOnce({ id: 'a', status: 'failed' })
      await expect(service.startAgent('a')).rejects.toThrow('not installed')
    })
  })

  describe('stopAgent', () => {
    it('calls disconnect', async () => {
      await service.stopAgent('test-agent')
      expect(mockDisconnect).toHaveBeenCalledWith('test-agent')
    })
  })

  describe('getRunningAgentMetrics', () => {
    it('returns metrics from process manager', () => {
      const metrics = [{ pid: 123, agentId: 'a1', uptimeMs: 1000 }]
      mockGetMetrics.mockReturnValueOnce(metrics)

      const result = service.getRunningAgentMetrics()
      expect(result).toEqual(metrics)
    })
  })
})
