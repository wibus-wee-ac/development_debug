import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { Readable, Writable } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import { buildCradleCodexAppServerEnv, CodexAppServerClient, resolveCodexAppServerHome } from './app-server-client'

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

describe('resolveCodexAppServerHome', () => {
  it('uses the Cradle data directory before database path fallback', () => {
    expect(resolveCodexAppServerHome({
      env: {
        CRADLE_DATA_DIR: '/tmp/cradle-data',
        CRADLE_DB_PATH: '/tmp/other/cradle.db',
        CODEX_HOME: '/Users/test/.codex',
      },
      homeDir: '/Users/test',
    })).toBe(join('/tmp/cradle-data', 'runtimes', 'codex-app-server'))
  })

  it('uses the Cradle database directory when data directory is unavailable', () => {
    expect(resolveCodexAppServerHome({
      env: {
        CRADLE_DB_PATH: '/tmp/cradle-data/cradle.db',
        CODEX_HOME: '/Users/test/.codex',
      },
      homeDir: '/Users/test',
    })).toBe(join('/tmp/cradle-data', 'runtimes', 'codex-app-server'))
  })

  it('falls back to a Cradle-owned home instead of the user Codex home', () => {
    expect(resolveCodexAppServerHome({
      env: {
        CODEX_HOME: '/Users/test/.codex',
      },
      homeDir: '/Users/test',
    })).toBe(join('/Users/test', '.cradle', 'runtimes', 'codex-app-server'))
  })
})

describe('CodexAppServerClient', () => {
  it('passes Cradle context environment into the app-server process', () => {
    spawnMock.mockReturnValueOnce({
      stdin: new Writable({ write: (_chunk, _encoding, callback) => callback() }),
      stdout: new Readable({ read: () => undefined }),
      stderr: new EventEmitter(),
      once: vi.fn(),
      kill: vi.fn(),
    })

    const client = new CodexAppServerClient({
      codexPath: 'codex-test',
      env: buildCradleCodexAppServerEnv({
        chatSessionId: 'chat-session-1',
        workspaceId: 'workspace-1',
      }),
    })

    expect(spawnMock).toHaveBeenCalledWith(
      'codex-test',
      ['app-server', '--listen', 'stdio://'],
      expect.objectContaining({
        env: expect.objectContaining({
          CRADLE_CHAT_SESSION_ID: 'chat-session-1',
          CRADLE_WORKSPACE_ID: 'workspace-1',
        }),
      }),
    )
    client.close()
  })
})
