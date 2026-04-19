// Input: vi mocks for ACP SDK, process manager, electron
// Output: Unit tests for AcpConnectionManager connect, session, disconnect, subscribe
// Position: Unit test file for src/main/lib/acp-connection.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AcpConnectionManager } from '../acp-connection'

// ── Hoisted mocks (available to vi.mock factories which run before module body) ─

const mocks = vi.hoisted(() => {
  const mockInitialize = vi.fn()
  const mockNewSession = vi.fn()
  const mockPrompt = vi.fn()
  const mockCancel = vi.fn()
  const mockSpawn = vi.fn()
  const mockStop = vi.fn()
  const mockClosed = new Promise<void>(() => {})
  return { mockInitialize, mockNewSession, mockPrompt, mockCancel, mockSpawn, mockStop, mockClosed }
})

vi.mock('@agentclientprotocol/sdk', () => {
  // A real class so `new ClientSideConnection(...)` works regardless of mockReset
  class FakeClientSideConnection {
    initialize = (...args: unknown[]) => mocks.mockInitialize(...args)
    newSession = (...args: unknown[]) => mocks.mockNewSession(...args)
    prompt = (...args: unknown[]) => mocks.mockPrompt(...args)
    cancel = (...args: unknown[]) => mocks.mockCancel(...args)
    closed = mocks.mockClosed
  }
  return {
    PROTOCOL_VERSION: '2025-draft',
    ndJsonStream: () => ({ readable: new ReadableStream(), writable: new WritableStream() }),
    ClientSideConnection: FakeClientSideConnection,
  }
})

vi.mock('../acp-process-manager', () => ({
  AcpProcessManager: {
    getInstance: () => ({
      spawn: (...args: unknown[]) => mocks.mockSpawn(...args),
      stop: (...args: unknown[]) => mocks.mockStop(...args),
    }),
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

async function drain<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = []
  for await (const v of gen) {
    out.push(v)
  }
  return out
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('acpConnectionManager', () => {
  let manager: AcpConnectionManager

  beforeEach(() => {
    mocks.mockInitialize.mockResolvedValue({ protocolVersion: '1.0' })
    mocks.mockNewSession.mockResolvedValue({ sessionId: 'sess-1' })
    mocks.mockPrompt.mockResolvedValue({ response: 'ok' })
    mocks.mockCancel.mockResolvedValue(undefined)
    mocks.mockSpawn.mockReturnValue({
      stdinWeb: new WritableStream(),
      stdoutWeb: new ReadableStream(),
    })
    manager = freshManager()
  })

  describe('connect', () => {
    it('spawns process and initializes connection', async () => {
      const result = await manager.connect('test-agent', fakeRecord)

      expect(mocks.mockSpawn).toHaveBeenCalledWith({
        agentId: 'test-agent',
        cmd: '@test/agent',
        args: ['--stdio'],
        env: {},
        distributionType: 'npx',
        installPath: null,
      })
      expect(mocks.mockInitialize).toHaveBeenCalled()
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
      expect(mocks.mockNewSession).toHaveBeenCalledWith({ cwd: '/tmp/workspace', mcpServers: [] })
      expect(result).toEqual({ sessionId: 'sess-1' })
    })

    it('prompt returns an async generator that calls underlying prompt', async () => {
      const gen = manager.prompt('test-agent', 'sess-1', 'hello')
      const chunks = await drain(gen)
      expect(mocks.mockPrompt).toHaveBeenCalledWith({
        sessionId: 'sess-1',
        prompt: [{ type: 'text', text: 'hello' }],
      })
      // No sessionUpdate was dispatched in this test, so no chunks were produced
      expect(chunks).toEqual([])
    })

    it('prompt generator rethrows when ACP prompt rejects', async () => {
      mocks.mockPrompt.mockRejectedValueOnce(new Error('agent offline'))
      const gen = manager.prompt('test-agent', 'sess-1', 'hi')
      await expect(drain(gen)).rejects.toThrow('agent offline')
    })

    it('cancels a prompt', async () => {
      await manager.cancel('test-agent', 'sess-1')
      expect(mocks.mockCancel).toHaveBeenCalledWith({ sessionId: 'sess-1' })
    })
  })

  describe('disconnect', () => {
    it('removes connection and stops process', async () => {
      await manager.connect('test-agent', fakeRecord)
      expect(manager.isConnected('test-agent')).toBe(true)

      await manager.disconnect('test-agent')
      expect(manager.isConnected('test-agent')).toBe(false)
      expect(mocks.mockStop).toHaveBeenCalledWith('test-agent')
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

  describe('onSessionTitle', () => {
    it('registers a handler and returns an unsubscribe function', () => {
      const cb = vi.fn()
      const off = manager.onSessionTitle(cb)
      expect(typeof off).toBe('function')
      off()
    })
  })

  describe('error handling', () => {
    it('throws when operating on disconnected agent', async () => {
      await expect(manager.newSession('no-agent', '/tmp')).rejects.toThrow('not connected')
      const gen = manager.prompt('no-agent', 's', 'hi')
      await expect(gen.next()).rejects.toThrow('not connected')
      await expect(manager.cancel('no-agent', 's')).rejects.toThrow('not connected')
    })
  })
})
