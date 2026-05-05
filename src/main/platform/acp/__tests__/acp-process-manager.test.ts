// Input: vi mocks for child_process, electron, stream
// Output: Unit tests for AcpProcessManager spawn, stop, metrics, dispose
// Position: Unit test file for src/main/platform/acp/acp-process-manager.ts

import EventEmitter from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getAcpDevtoolStore } from '../../../devtools/acp-devtool-store'
import { AcpProcessManager } from '../acp-process-manager'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    getPath: vi.fn(() => '/tmp/test-home'),
  },
}))

class MockChildProcess extends EventEmitter {
  pid = 12345
  exitCode: number | null = null
  stdin = new MockWritable()
  stdout = new MockReadable()
  stderr = new MockReadable()

  kill = vi.fn((signal?: string) => {
    if (signal === 'SIGKILL' || signal === 'SIGTERM') {
      this.exitCode = 1
      this.emit('exit', 1, signal)
    }
    return true
  })
}

class MockWritable extends EventEmitter {
  write = vi.fn()
  end = vi.fn()
}

class MockReadable extends EventEmitter {
  setEncoding = vi.fn()
}

let mockProc: MockChildProcess

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    mockProc = new MockChildProcess()
    return mockProc
  }),
}))

// Mock Writable.toWeb and Readable.toWeb
vi.mock('node:stream', async () => {
  const actual = await vi.importActual<typeof import('node:stream')>('node:stream')
  return {
    ...actual,
    Writable: {
      ...actual.Writable,
      toWeb: vi.fn(() => new WritableStream()),
    },
    Readable: {
      ...actual.Readable,
      toWeb: vi.fn(() => new ReadableStream()),
    },
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function freshManager(): AcpProcessManager {
  return new AcpProcessManager()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('acpProcessManager', () => {
  let manager: AcpProcessManager

  beforeEach(() => {
    vi.clearAllMocks()
    manager = freshManager()
    getAcpDevtoolStore().clear()
  })

  afterEach(() => {
    // Clean up
    manager.disposeAll()
  })

  describe('spawn', () => {
    it('spawns a binary agent process', () => {
      const entry = manager.spawn({
        agentId: 'test-agent',
        cmd: './agent',
        args: ['--stdio'],
        env: {},
        distributionType: 'binary',
        installPath: '/tmp/agents/test-agent',
      })

      expect(entry.agentId).toBe('test-agent')
      expect(entry.stdinWeb).toBeInstanceOf(WritableStream)
      expect(entry.stdoutWeb).toBeInstanceOf(ReadableStream)
      expect(entry.stderrBuf).toEqual([])
    })

    it('spawns an npx agent process', () => {
      const entry = manager.spawn({
        agentId: 'npx-agent',
        cmd: '@test/agent',
        args: [],
        env: {},
        distributionType: 'npx',
      })

      expect(entry.agentId).toBe('npx-agent')
    })

    it('spawns a uvx agent process', () => {
      const entry = manager.spawn({
        agentId: 'uvx-agent',
        cmd: 'test-agent',
        args: [],
        env: {},
        distributionType: 'uvx',
      })

      expect(entry.agentId).toBe('uvx-agent')
    })

    it('throws if agent is already running', () => {
      manager.spawn({
        agentId: 'dup-agent',
        cmd: './a',
        args: [],
        env: {},
        distributionType: 'binary',
        installPath: '/tmp/agents/dup',
      })

      expect(() => manager.spawn({
        agentId: 'dup-agent',
        cmd: './a',
        args: [],
        env: {},
        distributionType: 'binary',
        installPath: '/tmp/agents/dup',
      })).toThrow('already running')
    })

    it('throws when installPath missing for binary type', () => {
      expect(() => manager.spawn({
        agentId: 'no-path',
        cmd: './agent',
        args: [],
        env: {},
        distributionType: 'binary',
      })).toThrow('installPath is required')
    })
  })

  describe('isRunning', () => {
    it('returns true for running agents', () => {
      manager.spawn({
        agentId: 'running-agent',
        cmd: './a',
        args: [],
        env: {},
        distributionType: 'binary',
        installPath: '/tmp/agents/x',
      })

      expect(manager.isRunning('running-agent')).toBe(true)
    })

    it('returns false for unknown agents', () => {
      expect(manager.isRunning('unknown')).toBe(false)
    })
  })

  describe('getMetrics', () => {
    it('returns metrics for all running agents', () => {
      manager.spawn({
        agentId: 'metrics-agent',
        cmd: './a',
        args: [],
        env: {},
        distributionType: 'binary',
        installPath: '/tmp/agents/m',
      })

      const metrics = manager.getMetrics()
      expect(metrics).toHaveLength(1)
      expect(metrics[0].agentId).toBe('metrics-agent')
      expect(metrics[0].pid).toBe(12345)
      expect(metrics[0].uptimeMs).toBeGreaterThanOrEqual(0)
      expect(metrics[0].stderrLines).toEqual([])
    })

    it('returns empty array when no agents running', () => {
      expect(manager.getMetrics()).toEqual([])
    })

    it('records ACP stdout, stderr, and exit events for the devtool', () => {
      manager.spawn({
        agentId: 'metrics-agent',
        cmd: './a',
        args: [],
        env: {},
        distributionType: 'binary',
        installPath: '/tmp/agents/m',
      })

      mockProc.stdout.emit('data', Buffer.from('{"jsonrpc":"2.0"}\n'))
      mockProc.stderr.emit('data', 'first warning\n')
      mockProc.emit('exit', 0, null)

      const events = getAcpDevtoolStore().getSnapshot()
      expect(events.map(event => `${event.stream}:${event.kind}`)).toEqual([
        'lifecycle:spawn',
        'stdout:output',
        'stderr:output',
        'lifecycle:exit',
      ])
      expect(events[1]).toMatchObject({
        agentId: 'metrics-agent',
        stream: 'stdout',
        text: '{"jsonrpc":"2.0"}',
      })
      expect(events[3]).toMatchObject({
        stream: 'lifecycle',
        kind: 'exit',
        exitCode: 0,
        signal: null,
      })
    })
  })

  describe('stop', () => {
    it('does nothing for unknown agents', async () => {
      await expect(manager.stop('nonexistent')).resolves.toBeUndefined()
    })
  })

  describe('disposeAll', () => {
    it('kills all running processes', () => {
      manager.spawn({
        agentId: 'dispose-a',
        cmd: './a',
        args: [],
        env: {},
        distributionType: 'binary',
        installPath: '/tmp/agents/da',
      })

      manager.disposeAll()

      expect(manager.isRunning('dispose-a')).toBe(false)
    })

    it('prevents new spawns after disposal', () => {
      manager.disposeAll()

      expect(() => manager.spawn({
        agentId: 'post-dispose',
        cmd: './a',
        args: [],
        env: {},
        distributionType: 'binary',
        installPath: '/tmp/agents/pd',
      })).toThrow('disposed')
    })
  })
})
