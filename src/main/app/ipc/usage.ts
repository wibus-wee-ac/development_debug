// Input: IpcService decorator framework, drizzle-orm DB queries
// Output: UsageService IPC surface — aggregated token usage data for the cost dashboard
// Position: Main-process IPC layer (L2 surface) for usage analytics

import { IpcMethod, IpcService } from '@cradle/ipc'
import { sql } from 'drizzle-orm'

import { getDb } from '../../db'
import { usageLogs } from '../../db/schema'

export interface DailyUsage {
  date: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  count: number
}

export interface UsageSummary {
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  totalTurns: number
  byAgent: Array<{ agentProfileId: string, totalTokens: number, count: number }>
  byModel: Array<{ modelId: string, totalTokens: number, count: number }>
}

export class UsageService extends IpcService {
  static readonly groupName = 'usage'

  @IpcMethod()
  getDailyUsage(opts?: { days?: number }): DailyUsage[] {
    const days = opts?.days ?? 365
    const db = getDb()
    const rows = db.all<{
      date: string
      prompt_tokens: number
      completion_tokens: number
      total_tokens: number
      count: number
    }>(sql`
      SELECT
        date(${usageLogs.createdAt}, 'unixepoch') AS date,
        SUM(${usageLogs.promptTokens}) AS prompt_tokens,
        SUM(${usageLogs.completionTokens}) AS completion_tokens,
        SUM(${usageLogs.totalTokens}) AS total_tokens,
        COUNT(*) AS count
      FROM ${usageLogs}
      WHERE ${usageLogs.createdAt} >= unixepoch('now', '-' || ${days} || ' days')
      GROUP BY date(${usageLogs.createdAt}, 'unixepoch')
      ORDER BY date ASC
    `)
    return rows.map(r => ({
      date: r.date,
      promptTokens: r.prompt_tokens,
      completionTokens: r.completion_tokens,
      totalTokens: r.total_tokens,
      count: r.count,
    }))
  }

  @IpcMethod()
  getUsageSummary(): UsageSummary {
    const db = getDb()

    const totals = db.get<{
      prompt_tokens: number
      completion_tokens: number
      total_tokens: number
      count: number
    }>(sql`
      SELECT
        COALESCE(SUM(${usageLogs.promptTokens}), 0) AS prompt_tokens,
        COALESCE(SUM(${usageLogs.completionTokens}), 0) AS completion_tokens,
        COALESCE(SUM(${usageLogs.totalTokens}), 0) AS total_tokens,
        COUNT(*) AS count
      FROM ${usageLogs}
    `)

    const byAgent = db.all<{
      agent_profile_id: string
      total_tokens: number
      count: number
    }>(sql`
      SELECT
        ${usageLogs.agentProfileId} AS agent_profile_id,
        SUM(${usageLogs.totalTokens}) AS total_tokens,
        COUNT(*) AS count
      FROM ${usageLogs}
      WHERE ${usageLogs.agentProfileId} IS NOT NULL
      GROUP BY ${usageLogs.agentProfileId}
      ORDER BY total_tokens DESC
    `)

    const byModel = db.all<{
      model_id: string
      total_tokens: number
      count: number
    }>(sql`
      SELECT
        ${usageLogs.modelId} AS model_id,
        SUM(${usageLogs.totalTokens}) AS total_tokens,
        COUNT(*) AS count
      FROM ${usageLogs}
      WHERE ${usageLogs.modelId} IS NOT NULL
      GROUP BY ${usageLogs.modelId}
      ORDER BY total_tokens DESC
    `)

    return {
      totalPromptTokens: totals?.prompt_tokens ?? 0,
      totalCompletionTokens: totals?.completion_tokens ?? 0,
      totalTokens: totals?.total_tokens ?? 0,
      totalTurns: totals?.count ?? 0,
      byAgent: byAgent.map(r => ({
        agentProfileId: r.agent_profile_id,
        totalTokens: r.total_tokens,
        count: r.count,
      })),
      byModel: byModel.map(r => ({
        modelId: r.model_id,
        totalTokens: r.total_tokens,
        count: r.count,
      })),
    }
  }

  @IpcMethod()
  getUsageStats(): {
    currentStreak: number
    longestStreak: number
    activeDays: number
    avgDailyTokens: number
    peakDay: { date: string, totalTokens: number } | null
    todayTokens: number
  } {
    const db = getDb()

    // Get all distinct active dates (sorted)
    const activeDateRows = db.all<{ date: string }>(sql`
      SELECT DISTINCT date(${usageLogs.createdAt}, 'unixepoch') AS date
      FROM ${usageLogs}
      ORDER BY date ASC
    `)

    const dates = activeDateRows.map(r => r.date)
    const activeDays = dates.length

    // Compute streaks
    let currentStreak = 0
    let longestStreak = 0
    let streak = 0
    const today = new Date().toISOString().slice(0, 10)

    for (let i = dates.length - 1; i >= 0; i--) {
      const d = new Date(dates[i])
      const expected = new Date()
      expected.setDate(expected.getDate() - (dates.length - 1 - i))
      // For current streak: count back from today
      if (i === dates.length - 1) {
        // Check if the last active day is today or yesterday
        const dayDiff = Math.floor((Date.now() - d.getTime()) / 86400000)
        if (dayDiff > 1) {
          break
        }
      }
    }

    // Simpler streak calculation
    if (dates.length > 0) {
      const todayDate = new Date(today)
      const lastActive = new Date(dates[dates.length - 1])
      const daysSinceLast = Math.floor((todayDate.getTime() - lastActive.getTime()) / 86400000)

      if (daysSinceLast <= 1) {
        currentStreak = 1
        for (let i = dates.length - 2; i >= 0; i--) {
          const curr = new Date(dates[i + 1])
          const prev = new Date(dates[i])
          const gap = Math.floor((curr.getTime() - prev.getTime()) / 86400000)
          if (gap === 1) {
            currentStreak++
          }
          else {
            break
          }
        }
      }

      // Longest streak
      streak = 1
      longestStreak = 1
      for (let i = 1; i < dates.length; i++) {
        const curr = new Date(dates[i])
        const prev = new Date(dates[i - 1])
        const gap = Math.floor((curr.getTime() - prev.getTime()) / 86400000)
        if (gap === 1) {
          streak++
          if (streak > longestStreak) {
            longestStreak = streak
          }
        }
        else {
          streak = 1
        }
      }
    }

    // Average daily tokens (over active days only)
    const totalRow = db.get<{ total: number }>(sql`
      SELECT COALESCE(SUM(${usageLogs.totalTokens}), 0) AS total FROM ${usageLogs}
    `)
    const avgDailyTokens = activeDays > 0 ? Math.round((totalRow?.total ?? 0) / activeDays) : 0

    // Peak day
    const peakRow = db.get<{ date: string, total_tokens: number }>(sql`
      SELECT
        date(${usageLogs.createdAt}, 'unixepoch') AS date,
        SUM(${usageLogs.totalTokens}) AS total_tokens
      FROM ${usageLogs}
      GROUP BY date(${usageLogs.createdAt}, 'unixepoch')
      ORDER BY total_tokens DESC
      LIMIT 1
    `)
    const peakDay = peakRow ? { date: peakRow.date, totalTokens: peakRow.total_tokens } : null

    // Today's tokens
    const todayRow = db.get<{ total: number }>(sql`
      SELECT COALESCE(SUM(${usageLogs.totalTokens}), 0) AS total
      FROM ${usageLogs}
      WHERE date(${usageLogs.createdAt}, 'unixepoch') = date('now')
    `)
    const todayTokens = todayRow?.total ?? 0

    return {
      currentStreak,
      longestStreak,
      activeDays,
      avgDailyTokens,
      peakDay,
      todayTokens,
    }
  }

  @IpcMethod()
  getSessionUsage(chatSessionId: string): { totalTokens: number, promptTokens: number, completionTokens: number, count: number } {
    const db = getDb()
    const row = db.get<{
      prompt_tokens: number
      completion_tokens: number
      total_tokens: number
      count: number
    }>(sql`
      SELECT
        COALESCE(SUM(${usageLogs.promptTokens}), 0) AS prompt_tokens,
        COALESCE(SUM(${usageLogs.completionTokens}), 0) AS completion_tokens,
        COALESCE(SUM(${usageLogs.totalTokens}), 0) AS total_tokens,
        COUNT(*) AS count
      FROM ${usageLogs}
      WHERE ${usageLogs.sessionId} = ${chatSessionId}
    `)
    return {
      totalTokens: row?.total_tokens ?? 0,
      promptTokens: row?.prompt_tokens ?? 0,
      completionTokens: row?.completion_tokens ?? 0,
      count: row?.count ?? 0,
    }
  }
}
