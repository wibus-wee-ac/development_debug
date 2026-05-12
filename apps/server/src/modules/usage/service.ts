import { usageLogs } from '@cradle/db'
import { sql } from 'drizzle-orm'

import { db } from '../../infra'

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

export function getDailyUsage(days = 365): DailyUsage[] {
  const rows = db().all<{
    date: string
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    count: number
  }>(sql`
    SELECT
      date(${usageLogs.createdAt}, 'unixepoch', 'localtime') AS date,
      SUM(${usageLogs.promptTokens}) AS prompt_tokens,
      SUM(${usageLogs.completionTokens}) AS completion_tokens,
      SUM(${usageLogs.totalTokens}) AS total_tokens,
      COUNT(*) AS count
    FROM ${usageLogs}
    WHERE ${usageLogs.createdAt} >= unixepoch('now', 'localtime', '-' || ${days} || ' days')
    GROUP BY date(${usageLogs.createdAt}, 'unixepoch', 'localtime')
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

export function getUsageSummary(): UsageSummary {
  const totals = db().get<{
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

  const byAgent = db().all<{
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

  const byModel = db().all<{
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

export function getUsageStats(): {
  currentStreak: number
  longestStreak: number
  activeDays: number
  avgDailyTokens: number
  peakDay: { date: string, totalTokens: number } | null
  todayTokens: number
} {
  const activeDateRows = db().all<{ date: string }>(sql`
    SELECT DISTINCT date(${usageLogs.createdAt}, 'unixepoch', 'localtime') AS date
    FROM ${usageLogs}
    ORDER BY date ASC
  `)

  const dates = activeDateRows.map(row => row.date)
  const activeDays = dates.length
  let currentStreak = 0
  let longestStreak = 0
  let streak = 0
  // Use local date to match the 'localtime' modifier in DB queries
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  if (dates.length > 0) {
    const todayDate = new Date(today)
    const lastActive = new Date(dates.at(-1)!)
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

  const totalRow = db().get<{ total: number }>(sql`
    SELECT COALESCE(SUM(${usageLogs.totalTokens}), 0) AS total FROM ${usageLogs}
  `)
  const avgDailyTokens = activeDays > 0 ? Math.round((totalRow?.total ?? 0) / activeDays) : 0

  const peakRow = db().get<{ date: string, total_tokens: number }>(sql`
    SELECT
      date(${usageLogs.createdAt}, 'unixepoch', 'localtime') AS date,
      SUM(${usageLogs.totalTokens}) AS total_tokens
    FROM ${usageLogs}
    GROUP BY date(${usageLogs.createdAt}, 'unixepoch', 'localtime')
    ORDER BY total_tokens DESC
    LIMIT 1
  `)
  const peakDay = peakRow ? { date: peakRow.date, totalTokens: peakRow.total_tokens } : null

  const todayRow = db().get<{ total: number }>(sql`
    SELECT COALESCE(SUM(${usageLogs.totalTokens}), 0) AS total
    FROM ${usageLogs}
    WHERE date(${usageLogs.createdAt}, 'unixepoch', 'localtime') = date('now', 'localtime')
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

export function getSessionUsage(sessionId: string): {
  totalTokens: number
  promptTokens: number
  completionTokens: number
  count: number
} {
  const row = db().get<{
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
