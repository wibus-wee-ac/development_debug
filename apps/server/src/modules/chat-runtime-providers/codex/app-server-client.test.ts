// Output: Regression coverage for Codex app-server process isolation.
// Input: Runtime environment paths used to launch Codex app-server.
// Position: Provider-owned tests for keeping Cradle-managed Codex runs out of user Codex config.

import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveCodexAppServerHome } from './app-server-client'

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
