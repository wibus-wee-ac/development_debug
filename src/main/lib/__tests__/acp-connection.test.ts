// Input: vi mocks for ACP SDK, process manager, electron
// Output: Unit tests for AcpConnectionManager connect, session, disconnect
// Position: Unit test file for src/main/lib/acp-connection.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AcpConnectionManager } from '../acp-connection'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockInitialize = vi.fn().mockResolvedValue({ protocolVersion: '1.0' })
const mockNewSession = vi.fn().mockResolvedValue({ sessionId: 'sess-1' })
const mockPrompt = vi.fn().mockResolvedValue({ response: 'ok' })
const mockCancel = vi.fn().mockResolvedValue(undefined)
const mockClosed = new Promise<void>(() => {})

vi.mock('@agentclientprotocol/sdk', () => ({
  PROTOCOL_VERSION: '2025-draft',
  ndJsonStream: vi.fn(() => ({ readable: new ReadableStream(), writable: new WritableStream() })),
  ClientSideConnection: vi.fn().mockImplementation(() => ({
    initialize: mockInitialize,
    newSession: mockNewSession,
    prompt: mockPrompt,
    cancel: mockCancel,
    closed: mockClosed,
  })),
}))

const mockSpawn = vi.fn().mockReturnValue({
  stdinWeb: new WritableStream(),
  stdoutWeb: new ReadableStream(),
})
const mockStop = vi.fn()

vi.mock('../acp-process-manager', () => ({
  AcpProcessManager: {
    getInstance: vi.fn(() => ({
      spawn: mockSpawn,
      stop: mockStop,
    })),
  },
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function freshManager(): AcpConnectionManager {
  // @ts-expect-error accessing private static for testing
  AcpConnectionManager.instance = undefined
  return AcpConnectionManager.getInstance()
}

const fakeRecord = {
  distributionType: 'npx',
  installPath: null,
  cmd: '@test/agent',
  args: '["--stdio"]',
  env: '{}',
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('acpConnectionManager', () => {
  let manager: AcpConnectionManager

  beforeEach(() => {
    vi.clearAllMocks()
    manager = freshManager()
  })

  describe('connect', () => {
    it('spawns process and initializes connection', async () => {
      const result = await manager.connect('test-agent', fakeRecord)

      expect(mockSpawn).toHaveBeenCalledWith({
        agentId: 'test-agent',
        cmd: '@test/agent',
        args: ['--stdio'],
        env: {},
        distributionType: 'npx',
        installPath: null,
      })
      expect(mockInitialize).toHaveBeenCalled()
      expect(result).toEqual({ protocolVersion: '1.0' })
    })

    it('throws if agent is already connected', async () => {
      await manager.connect('test-agent', fakeRecord)
      await expect(manager.connect('test-agent', fakeRecord)).rejects.toThrow('already connected')
    })
  })

  describe('session operations', () => {
    beforeEach(async () => {
      await manager.connect('test-agent', fakeRecord)
    })

    it('creates a new session', async () => {
      const result = await manager.newSession('test-agent', '/tmp/workspace')
      expect(mockNewSession).toHaveBeenCalledWith({ cwd: '/tmp/workspace', mcpServers: [] })
      expect(result).toEqual({ sessionId: 'sess-1' })
    })

    it('sends a prompt', async () => {
      const result = await manager.prompt('test-agent', 'sess-1', 'hello')
      expect(mockPrompt).toHaveBeenCalledWith({
        sessionId: 'sess-1',
        prompt: [{ type: 'text', text: 'hello' }],
      })
      expect(result).toEqual({ response: 'ok' })
    })

    it('cancels a prompt', async () => {
      await manager.cancel('test-agent', 'sess-1')
      expect(mockCancel).toHaveBeenCalledWith({ sessionId: 'sess-1' })
    })
  })

  describe('disconnect', () => {
    it('removes connection and stops process', async () => {
      await manager.connect('test-agent', fakeRecord)
      expect(manager.isConnected('test-agent')).toBe(true)

      await manager.disconnect('test-agent')
      expect(manager.isConnected('test-agent')).toBe(false)
      expect(mockStop).toHaveBeenCalledWith('test-agent')
    })
  })

  describe('isConnected', () => {
    it('returns false for unknown agents', () => {
      expect(manager.isConnected('unknown')).toBe(false)
    })
  })

  describe('getInitResult', () => {
    it('returns null for unknown agents', () => {
      expect(manager.getInitResult('unknown')).toBeNull()
    })

    it('returns init result for connected agents', async () => {
      await manager.connect('test-agent', fakeRecord)
      expect(manager.getInitResult('test-agent')).toEqual({ protocolVersion: '1.0' })
    })
  })

  describe('setWebContents', () => {
    it('stores webContents without error', () => {
      const fakeWc = { send: vi.fn(), isDestroyed: vi.fn(() => false) }
      expect(() => manager.setWebContents(fakeWc as never)).not.toThrow()
    })
  })

  describe('error handling', () => {
    it('throws when operating on disconnected agent', async () => {
      await expect(manager.newSession('no-agent', '/tmp')).rejects.toThrow('not connected')
      await expect(manager.prompt('no-agent', 's', 'hi')).rejects.toThrow('not connected')
      await expect(manager.cancel('no-agent', 's')).rejects.toThrow('not connected')
    })
  })
})
