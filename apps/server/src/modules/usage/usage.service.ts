// Input: DbAccessor and usage_logs schema
// Output: usage analytics queries for the usage dashboard
// Position: apps/server/src/modules/usage/usage.service.ts

import { sql } from 'drizzle-orm'
import { injectable } from 'tsyringe'

import { usageLogs } from '@cradle/db'

import { DbAccessor } from '../../database/db-accessor'

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

@injectable()
export class UsageService {
  constructor(private readonly dbAccessor: DbAccessor) {}

  getDailyUsage(days = 365): DailyUsage[] {
    const db = this.dbAccessor.get()
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

    return rows.map(row => ({
      date: row.date,
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      totalTokens: row.total_tokens,
      count: row.count,
    }))
  }

  getUsageSummary(): UsageSummary {
    const db = this.dbAccessor.get()
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
      byAgent: byAgent.map(row => ({
        agentProfileId: row.agent_profile_id,
        totalTokens: row.total_tokens,
        count: row.count,
      })),
      byModel: byModel.map(row => ({
        modelId: row.model_id,
        totalTokens: row.total_tokens,
        count: row.count,
      })),
    }
  }

  getUsageStats(): {
    currentStreak: number
    longestStreak: number
    activeDays: number
    avgDailyTokens: number
    peakDay: { date: string, totalTokens: number } | null
    todayTokens: number
  } {
    const db = this.dbAccessor.get()
    const activeDateRows = db.all<{ date: string }>(sql`
      SELECT DISTINCT date(${usageLogs.createdAt}, 'unixepoch') AS date
      FROM ${usageLogs}
      ORDER BY date ASC
    `)

    const dates = activeDateRows.map(row => row.date)
    const activeDays = dates.length
    let currentStreak = 0
    let longestStreak = 0
    let streak = 0
    const today = new Date().toISOString().slice(0, 10)

    if (dates.length > 0) {
      const todayDate = new Date(today)
      const lastActive = new Date(dates[dates.length - 1])
      const daysSinceLast = Math.floor((todayDate.getTime() - lastActive.getTime()) / 86400000)

      if (daysSinceLast <= 1) {
        currentStreak = 1
        for (let index = dates.length - 2; index >= 0; index--) {
          const current = new Date(dates[index + 1])
          const previous = new Date(dates[index])
          const gap = Math.floor((current.getTime() - previous.getTime()) / 86400000)
          if (gap === 1) {
            currentStreak++
          }
          else {
            break
          }
        }
      }

      streak = 1
      longestStreak = 1
      for (let index = 1; index < dates.length; index++) {
        const current = new Date(dates[index])
        const previous = new Date(dates[index - 1])
        const gap = Math.floor((current.getTime() - previous.getTime()) / 86400000)
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

    const totalRow = db.get<{ total: number }>(sql`
      SELECT COALESCE(SUM(${usageLogs.totalTokens}), 0) AS total FROM ${usageLogs}
    `)
    const avgDailyTokens = activeDays > 0 ? Math.round((totalRow?.total ?? 0) / activeDays) : 0

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

    const todayRow = db.get<{ total: number }>(sql`
      SELECT COALESCE(SUM(${usageLogs.totalTokens}), 0) AS total
      FROM ${usageLogs}
      WHERE date(${usageLogs.createdAt}, 'unixepoch') = date('now')
    `)

    return {
      currentStreak,
      longestStreak,
      activeDays,
      avgDailyTokens,
      peakDay,
      todayTokens: todayRow?.total ?? 0,
    }
  }

  getSessionUsage(sessionId: string): { totalTokens: number, promptTokens: number, completionTokens: number, count: number } {
    const row = this.dbAccessor.get().get<{
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
      WHERE ${usageLogs.sessionId} = ${sessionId}
    `)

    return {
      totalTokens: row?.total_tokens ?? 0,
      promptTokens: row?.prompt_tokens ?? 0,
      completionTokens: row?.completion_tokens ?? 0,
      count: row?.count ?? 0,
    }
  }
}
