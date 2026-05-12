// Input: usage HTTP endpoints
// Output: integration tests for usage aggregations and stats
// Position: apps/server/tests

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { agentProfiles, sessions, usageLogs, workspaces } from '@cradle/db'
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function unixDaysAgo(daysAgo: number): number {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() - daysAgo)
  return Math.floor(date.getTime() / 1000)
}

function isoDaysAgo(daysAgo: number): string {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() - daysAgo)
  return date.toISOString().slice(0, 10)
}

describe('usage capability', () => {
  it('aggregates daily usage, summary, stats, and session totals', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: ReturnType<typeof createServerApp> | undefined

    try {
      app = createServerApp()
      const d = db()

      const workspaceId = randomUUID()
      const profileOneId = randomUUID()
      const profileTwoId = randomUUID()
      const sessionOneId = randomUUID()
      const sessionTwoId = randomUUID()

      d.insert(workspaces).values({ id: workspaceId, name: 'Workspace', path: workspaceRoot }).run()
      d.insert(agentProfiles).values([
        { id: profileOneId, name: 'Profile One', providerKind: 'openai-compatible' },
        { id: profileTwoId, name: 'Profile Two', providerKind: 'codex' },
      ]).run()
      d.insert(sessions).values([
        { id: sessionOneId, workspaceId, title: 'Session One', agentProfileId: profileOneId },
        { id: sessionTwoId, workspaceId, title: 'Session Two', agentProfileId: profileTwoId },
      ]).run()
      d.insert(usageLogs).values([
        {
          id: randomUUID(),
          sessionId: sessionOneId,
          messageId: null,
          agentProfileId: profileOneId,
          modelId: 'gpt-4o',
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
          createdAt: unixDaysAgo(2),
        },
        {
          id: randomUUID(),
          sessionId: sessionOneId,
          messageId: null,
          agentProfileId: profileOneId,
          modelId: 'gpt-4o',
          promptTokens: 20,
          completionTokens: 10,
          totalTokens: 30,
          createdAt: unixDaysAgo(1),
        },
        {
          id: randomUUID(),
          sessionId: sessionTwoId,
          messageId: null,
          agentProfileId: profileTwoId,
          modelId: 'codex-mini',
          promptTokens: 8,
          completionTokens: 7,
          totalTokens: 15,
          createdAt: unixDaysAgo(0),
        },
      ]).run()

      const dailyRes = await app.handle(new Request('http://localhost/usage/daily?days=30'))
      expect(dailyRes.status).toBe(200)
      expect(await dailyRes.json()).toEqual([
        { date: isoDaysAgo(2), promptTokens: 10, completionTokens: 5, totalTokens: 15, count: 1 },
        { date: isoDaysAgo(1), promptTokens: 20, completionTokens: 10, totalTokens: 30, count: 1 },
        { date: isoDaysAgo(0), promptTokens: 8, completionTokens: 7, totalTokens: 15, count: 1 },
      ])

      const summaryRes = await app.handle(new Request('http://localhost/usage/summary'))
      expect(summaryRes.status).toBe(200)
      expect(await summaryRes.json()).toEqual({
        totalPromptTokens: 38,
        totalCompletionTokens: 22,
        totalTokens: 60,
        totalTurns: 3,
        byAgent: [
          { agentProfileId: profileOneId, totalTokens: 45, count: 2 },
          { agentProfileId: profileTwoId, totalTokens: 15, count: 1 },
        ],
        byModel: [
          { modelId: 'gpt-4o', totalTokens: 45, count: 2 },
          { modelId: 'codex-mini', totalTokens: 15, count: 1 },
        ],
      })

      const statsRes = await app.handle(new Request('http://localhost/usage/stats'))
      expect(statsRes.status).toBe(200)
      expect(await statsRes.json()).toEqual({
        currentStreak: 3,
        longestStreak: 3,
        activeDays: 3,
        avgDailyTokens: 20,
        peakDay: { date: isoDaysAgo(1), totalTokens: 30 },
        todayTokens: 15,
      })

      const sessionUsageRes = await app.handle(new Request(`http://localhost/usage/sessions/${sessionOneId}`))
      expect(sessionUsageRes.status).toBe(200)
      expect(await sessionUsageRes.json()).toEqual({
        totalTokens: 45,
        promptTokens: 30,
        completionTokens: 15,
        count: 2,
      })

      const invalidDaily = await app.handle(new Request('http://localhost/usage/daily?days=0'))
      expect(invalidDaily.status).toBe(400)
      expect((await invalidDaily.json()).code).toBe('validation_error')
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })
})
