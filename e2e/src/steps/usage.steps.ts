// Input: Cucumber usage dashboard steps, Playwright assertions, and shared SQLite helpers
// Output: Usage dashboard E2E steps covering empty state, precise summary values, tooltip behavior, and usage_logs persistence
// Position: Focused step layer for the usage/cost dashboard's first real user journeys

import type { DataTable } from '@cucumber/cucumber'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import { queryDatabaseRow, queryDatabaseRows } from '../support/database'
import type { CradleWorld } from '../support/world'

const USAGE_TIMEOUT = 15_000
const CURRENT_CHAT_SESSION_ID_KEY = 'currentChatSessionId'

type UsageCountRow = {
  count: number
}

type UsageLogRow = {
  sessionId: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  agentProfileId: string | null
  modelId: string | null
}

type UsageAggregateRow = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  totalTurns: number
  activeDays: number
  todayTokens: number
}

const DASHBOARD_VALUE_TEST_IDS: Record<string, string> = {
  '总 Tokens': 'usage-total-tokens',
  'Prompt Tokens': 'usage-pill-prompt-tokens-value',
  'Completion Tokens': 'usage-pill-completion-tokens-value',
  '总 Turns': 'usage-pill-total-turns-value',
  '今日 Tokens': 'usage-pill-today-tokens-value',
  '活跃天数': 'usage-pill-active-days-value',
}

function usageDashboard(world: CradleWorld) {
  return world.page.locator('[data-testid="usage-dashboard"]:visible').first()
}

function usageDashboardValue(world: CradleWorld, testId: string) {
  return usageDashboard(world).locator(`[data-testid="${testId}"]`).first()
}

async function queryUsageCount(world: CradleWorld): Promise<number> {
  const row = await queryDatabaseRow<UsageCountRow>(
    world,
    'SELECT COUNT(*) AS count FROM usage_logs',
  )

  return row?.count ?? 0
}

async function queryUsageRowsForSession(world: CradleWorld, sessionId: string): Promise<UsageLogRow[]> {
  return queryDatabaseRows<UsageLogRow>(
    world,
    `
      SELECT
        session_id AS sessionId,
        prompt_tokens AS promptTokens,
        completion_tokens AS completionTokens,
        total_tokens AS totalTokens,
        agent_profile_id AS agentProfileId,
        model_id AS modelId
      FROM usage_logs
      WHERE session_id = ?
      ORDER BY created_at ASC
    `,
    [sessionId],
  )
}

async function queryUsageAggregate(world: CradleWorld): Promise<UsageAggregateRow> {
  const row = await queryDatabaseRow<UsageAggregateRow>(
    world,
    `
      SELECT
        COALESCE(SUM(prompt_tokens), 0) AS promptTokens,
        COALESCE(SUM(completion_tokens), 0) AS completionTokens,
        COALESCE(SUM(total_tokens), 0) AS totalTokens,
        COUNT(*) AS totalTurns,
        COUNT(DISTINCT date(created_at, 'unixepoch')) AS activeDays,
        COALESCE(SUM(CASE WHEN date(created_at, 'unixepoch') = date('now') THEN total_tokens ELSE 0 END), 0) AS todayTokens
      FROM usage_logs
    `,
  )

  if (!row) {
    return {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      totalTurns: 0,
      activeDays: 0,
      todayTokens: 0,
    }
  }

  return row
}

When('我从侧栏打开 Usage Dashboard', async function (this: CradleWorld) {
  console.warn('[step] open usage dashboard from sidebar nav')
  const navItem = this.page.locator('[data-testid="nav-usage"]')

  await expect(navItem).toBeVisible({ timeout: USAGE_TIMEOUT })
  await navItem.click()
  await expect(usageDashboard(this)).toBeVisible({ timeout: USAGE_TIMEOUT })
})

Then('我应该看到 Usage Dashboard', async function (this: CradleWorld) {
  const dashboard = usageDashboard(this)

  await expect(dashboard).toBeVisible({ timeout: USAGE_TIMEOUT })
  await expect(dashboard.locator('[data-testid="usage-dashboard-title"]')).toHaveText('Usage', { timeout: USAGE_TIMEOUT })
})

Then('Usage Dashboard 应显示空状态', async function (this: CradleWorld) {
  await expect(usageDashboard(this).locator('[data-testid="usage-empty-state"]')).toBeVisible({ timeout: USAGE_TIMEOUT })
  await expect(usageDashboard(this).locator('[data-testid="usage-empty-state"]')).toContainText('No usage data yet', { timeout: USAGE_TIMEOUT })
})

Then('usage_logs 表中应该没有记录', async function (this: CradleWorld) {
  expect(await queryUsageCount(this)).toBe(0)
})

Then('当前聊天会话应持久化 {int} 条 usage 记录，Prompt Tokens 为 {int}、Completion Tokens 为 {int}、Total Tokens 为 {int}', async function (
  this: CradleWorld,
  expectedCount: number,
  expectedPromptTokens: number,
  expectedCompletionTokens: number,
  expectedTotalTokens: number,
) {
  const sessionId = this.recall<string>(CURRENT_CHAT_SESSION_ID_KEY)

  await expect.poll(async () => {
    const rows = await queryUsageRowsForSession(this, sessionId)
    return rows.length
  }, { timeout: USAGE_TIMEOUT }).toBe(expectedCount)

  const rows = await queryUsageRowsForSession(this, sessionId)
  expect(rows).toHaveLength(expectedCount)

  const [row] = rows
  if (!row) {
    throw new Error(`Expected usage log row for session ${sessionId}`)
  }

  expect(row).toEqual(expect.objectContaining({
    sessionId,
    promptTokens: expectedPromptTokens,
    completionTokens: expectedCompletionTokens,
    totalTokens: expectedTotalTokens,
    agentProfileId: 'mock-llm-profile',
    modelId: 'mock-model',
  }))
})

Then('Usage Dashboard 应显示以下关键值:', async function (this: CradleWorld, table: DataTable) {
  for (const [label, expectedValue] of table.raw()) {
    const testId = DASHBOARD_VALUE_TEST_IDS[label]
    if (!testId) {
      throw new Error(`Unsupported usage dashboard value label: ${label}`)
    }

    await expect(usageDashboardValue(this, testId)).toHaveText(expectedValue, { timeout: USAGE_TIMEOUT })
  }
})

Then('Usage Dashboard 应与 usage_logs 汇总一致', async function (this: CradleWorld) {
  const aggregate = await queryUsageAggregate(this)

  await expect(usageDashboardValue(this, 'usage-total-tokens')).toHaveText(String(aggregate.totalTokens), { timeout: USAGE_TIMEOUT })
  await expect(usageDashboardValue(this, 'usage-pill-prompt-tokens-value')).toHaveText(String(aggregate.promptTokens), { timeout: USAGE_TIMEOUT })
  await expect(usageDashboardValue(this, 'usage-pill-completion-tokens-value')).toHaveText(String(aggregate.completionTokens), { timeout: USAGE_TIMEOUT })
  await expect(usageDashboardValue(this, 'usage-pill-total-turns-value')).toHaveText(String(aggregate.totalTurns), { timeout: USAGE_TIMEOUT })
  await expect(usageDashboardValue(this, 'usage-pill-active-days-value')).toHaveText(String(aggregate.activeDays), { timeout: USAGE_TIMEOUT })
  await expect(usageDashboardValue(this, 'usage-pill-today-tokens-value')).toHaveText(String(aggregate.todayTokens), { timeout: USAGE_TIMEOUT })
})

Then('Usage Dashboard Heatmap 今天的提示应显示{string}', async function (this: CradleWorld, expectedMetrics: string) {
  const today = new Date().toISOString().slice(0, 10)
  const dashboard = usageDashboard(this)
  const todayCell = dashboard.locator(`[data-testid="usage-heatmap-cell"][data-date="${today}"][data-has-usage="true"]`).first()

  await expect(todayCell).toBeVisible({ timeout: USAGE_TIMEOUT })
  await todayCell.hover()

  const tooltip = dashboard.locator('[data-testid="usage-heatmap-tooltip"]').first()
  await expect(tooltip).toBeVisible({ timeout: USAGE_TIMEOUT })
  await expect(tooltip.locator('[data-testid="usage-heatmap-tooltip-date"]')).toHaveText(today, { timeout: USAGE_TIMEOUT })
  await expect(tooltip.locator('[data-testid="usage-heatmap-tooltip-metrics"]')).toHaveText(expectedMetrics, { timeout: USAGE_TIMEOUT })
})
