import { stepUsage, usageLogs } from '@cradle/db'
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

// ── Cost Dashboard queries (Phase 4) ──

export interface CostSummary {
  totalCostUsd: number
  totalPromptTokens: number
  totalCompletionTokens: number
  totalTokens: number
  byModel: Array<{ modelId: string, costUsd: number, promptTokens: number, completionTokens: number, totalTokens: number, count: number }>
}

export function getCostSummary(from?: string, to?: string): CostSummary {
  const fromEpoch = from ? Math.floor(new Date(from).getTime() / 1000) : 0
  const toEpoch = to ? Math.floor(new Date(to).getTime() / 1000) + 86400 : Math.floor(Date.now() / 1000) + 86400

  const totals = db().get<{
    cost: number
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }>(sql`
    SELECT
      COALESCE(SUM(${stepUsage.estimatedCostUsd}), 0) AS cost,
      COALESCE(SUM(${stepUsage.promptTokens}), 0) AS prompt_tokens,
      COALESCE(SUM(${stepUsage.completionTokens}), 0) AS completion_tokens,
      COALESCE(SUM(${stepUsage.totalTokens}), 0) AS total_tokens
    FROM ${stepUsage}
    WHERE ${stepUsage.createdAt} >= ${fromEpoch}
      AND ${stepUsage.createdAt} < ${toEpoch}
  `)

  const byModel = db().all<{
    model_id: string
    cost: number
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    count: number
  }>(sql`
    SELECT
      COALESCE(${stepUsage.modelId}, 'unknown') AS model_id,
      SUM(${stepUsage.estimatedCostUsd}) AS cost,
      SUM(${stepUsage.promptTokens}) AS prompt_tokens,
      SUM(${stepUsage.completionTokens}) AS completion_tokens,
      SUM(${stepUsage.totalTokens}) AS total_tokens,
      COUNT(*) AS count
    FROM ${stepUsage}
    WHERE ${stepUsage.createdAt} >= ${fromEpoch}
      AND ${stepUsage.createdAt} < ${toEpoch}
    GROUP BY ${stepUsage.modelId}
    ORDER BY cost DESC
  `)

  return {
    totalCostUsd: totals?.cost ?? 0,
    totalPromptTokens: totals?.prompt_tokens ?? 0,
    totalCompletionTokens: totals?.completion_tokens ?? 0,
    totalTokens: totals?.total_tokens ?? 0,
    byModel: byModel.map(row => ({
      modelId: row.model_id,
      costUsd: row.cost,
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      totalTokens: row.total_tokens,
      count: row.count,
    })),
  }
}

export interface SessionCostEntry {
  sessionId: string
  costUsd: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  stepCount: number
}

export function getSessionsCost(from?: string, to?: string): SessionCostEntry[] {
  const fromEpoch = from ? Math.floor(new Date(from).getTime() / 1000) : 0
  const toEpoch = to ? Math.floor(new Date(to).getTime() / 1000) + 86400 : Math.floor(Date.now() / 1000) + 86400

  const rows = db().all<{
    session_id: string
    cost: number
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    step_count: number
  }>(sql`
    SELECT
      ${stepUsage.sessionId} AS session_id,
      SUM(${stepUsage.estimatedCostUsd}) AS cost,
      SUM(${stepUsage.promptTokens}) AS prompt_tokens,
      SUM(${stepUsage.completionTokens}) AS completion_tokens,
      SUM(${stepUsage.totalTokens}) AS total_tokens,
      COUNT(*) AS step_count
    FROM ${stepUsage}
    WHERE ${stepUsage.createdAt} >= ${fromEpoch}
      AND ${stepUsage.createdAt} < ${toEpoch}
    GROUP BY ${stepUsage.sessionId}
    ORDER BY cost DESC
  `)

  return rows.map(row => ({
    sessionId: row.session_id,
    costUsd: row.cost,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    stepCount: row.step_count,
  }))
}

export interface DailyCostEntry {
  date: string
  costUsd: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  stepCount: number
}

export function getDailyCost(from?: string, to?: string): DailyCostEntry[] {
  const fromEpoch = from ? Math.floor(new Date(from).getTime() / 1000) : 0
  const toEpoch = to ? Math.floor(new Date(to).getTime() / 1000) + 86400 : Math.floor(Date.now() / 1000) + 86400

  const rows = db().all<{
    date: string
    cost: number
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    step_count: number
  }>(sql`
    SELECT
      date(${stepUsage.createdAt}, 'unixepoch', 'localtime') AS date,
      SUM(${stepUsage.estimatedCostUsd}) AS cost,
      SUM(${stepUsage.promptTokens}) AS prompt_tokens,
      SUM(${stepUsage.completionTokens}) AS completion_tokens,
      SUM(${stepUsage.totalTokens}) AS total_tokens,
      COUNT(*) AS step_count
    FROM ${stepUsage}
    WHERE ${stepUsage.createdAt} >= ${fromEpoch}
      AND ${stepUsage.createdAt} < ${toEpoch}
    GROUP BY date(${stepUsage.createdAt}, 'unixepoch', 'localtime')
    ORDER BY date ASC
  `)

  return rows.map(row => ({
    date: row.date,
    costUsd: row.cost,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    stepCount: row.step_count,
  }))
}

export function getTodayCostUsd(): number {
  const row = db().get<{ cost: number }>(sql`
    SELECT COALESCE(SUM(${stepUsage.estimatedCostUsd}), 0) AS cost
    FROM ${stepUsage}
    WHERE date(${stepUsage.createdAt}, 'unixepoch', 'localtime') = date('now', 'localtime')
  `)
  return row?.cost ?? 0
}
