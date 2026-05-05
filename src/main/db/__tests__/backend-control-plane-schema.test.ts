// Input: main-process Drizzle schema exports, table metadata helpers, and migration artifacts
// Output: Regression tests for backend control-plane schema ownership and Drizzle migration consistency
// Position: Schema-level guardrail for backend bindings/runs/timeline tables and migration history

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { getTableColumns } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import * as schema from '../schema'

describe('backend control plane schema', () => {
  it('exports backend control-plane tables and removes legacy runtimeSessions', () => {
    expect(schema.backendSessionBindings).toBeDefined()
    expect(schema.backendRuns).toBeDefined()
    expect(schema.backendCapabilitySnapshots).toBeDefined()
    expect('runtimeSessions' in schema).toBe(false)
  })

  it('keeps backend-owned provider state off product sessions', () => {
    const sessionColumns = Object.keys(getTableColumns(schema.sessions))

    expect(sessionColumns).not.toContain('providerKind')
    expect(sessionColumns).not.toContain('providerSessionId')
    expect(sessionColumns).not.toContain('providerStateSnapshot')
    expect(sessionColumns).not.toContain('modelId')
    expect(sessionColumns).not.toContain('configSnapshot')
  })

  it('keeps the Drizzle baseline plus timeline migration internally consistent', () => {
    const journal = JSON.parse(
      readFileSync(resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
    ) as {
      entries: Array<{ tag: string }>
    }
    const baselineSql = readFileSync(
      resolve(process.cwd(), 'drizzle/0000_initial_baseline.sql'),
      'utf8',
    )
    const latestTag = journal.entries.at(-1)?.tag

    expect(latestTag).toBeDefined()

    const latestMigrationSql = readFileSync(
      resolve(process.cwd(), `drizzle/${latestTag}.sql`),
      'utf8',
    )

    expect(journal.entries.length).toBeGreaterThanOrEqual(2)
    expect(journal.entries[0]?.tag).toBe('0000_initial_baseline')
    expect(baselineSql).toContain('CREATE TABLE `backend_session_bindings`')
    expect(baselineSql).toContain('CREATE TABLE `backend_runs`')
    expect(baselineSql).toContain('CREATE TABLE `backend_capability_snapshots`')
    expect(baselineSql).not.toContain('runtime_sessions')
    expect(latestMigrationSql).toContain('CREATE TABLE `backend_timeline_events`')
  })
})