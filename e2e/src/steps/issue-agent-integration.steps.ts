// Input: Cucumber issue-agent step bindings, Playwright assertions, and chat/kanban UI anchors
// Output: Issue delegation step definitions covering agent assignment, completion, and undelegation flows
// Position: E2E step layer covering issue-agent-integration.feature delegated issue scenarios

import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world'

const DELEGATE_TRIGGER = '[data-testid="issue-agent-delegate-trigger"]'
const DELEGATE_OPTIONS = '[data-testid^="issue-agent-option-"]'
const AGENT_SESSION = '[data-testid="issue-agent-session"]'
const AGENT_SESSION_PHASE = '[data-testid="issue-agent-session-phase"]'
const AGENT_SESSION_OPEN_CHAT = '[data-testid="issue-agent-session-open-chat"]'
const ISSUE_ACTIVITY_TIMELINE = '[data-testid="issue-activity-timeline"]'
const STARTED_AGENT_SESSION_STATUS = /^(created|active|completed)$/

async function selectAgentForCurrentIssue(world: CradleWorld, agentName: string): Promise<void> {
  const trigger = world.page.locator(DELEGATE_TRIGGER)
  await expect(trigger).toBeVisible({ timeout: 10_000 })
  await trigger.click()

  const option = world.page.locator(DELEGATE_OPTIONS).filter({ hasText: agentName }).first()
  await expect(option).toBeVisible({ timeout: 10_000 })
  await option.click()
}

async function waitForAgentSessionStatus(world: CradleWorld, expected: string | RegExp): Promise<void> {
  const phase = world.page.locator(AGENT_SESSION_PHASE)
  await expect(phase).toBeVisible({ timeout: 10_000 })
  await expect(phase).toHaveAttribute('data-agent-session-status', expected, { timeout: 30_000 })
}

When('我将当前 Issue 委派给{string}', async function (this: CradleWorld, agentName: string) {
  console.warn(`[step] delegate current issue to ${agentName}`)
  await selectAgentForCurrentIssue(this, agentName)
})

Then('当前 Issue 的 Agent 会话应开始运行', async function (this: CradleWorld) {
  await expect(this.page.locator(AGENT_SESSION)).toBeVisible({ timeout: 10_000 })
  await waitForAgentSessionStatus(this, STARTED_AGENT_SESSION_STATUS)
})

Then('当前 Issue 的 Agent 会话最终应完成', async function (this: CradleWorld) {
  await waitForAgentSessionStatus(this, 'completed')
})

Then('Activity 时间线应显示{string}', async function (this: CradleWorld, text: string) {
  await expect(this.page.locator(ISSUE_ACTIVITY_TIMELINE).locator(`text=${text}`)).toBeVisible({ timeout: 30_000 })
})

Then('我可以打开当前 Issue 的 Agent 聊天会话', async function (this: CradleWorld) {
  const button = this.page.locator(AGENT_SESSION_OPEN_CHAT)
  await expect(button).toBeVisible({ timeout: 10_000 })
  await button.click()
  await expect(this.page.locator('[data-testid="chat-view"]')).toBeVisible({ timeout: 30_000 })
})

Given('我已将当前 Issue 委派给{string}', async function (this: CradleWorld, agentName: string) {
  await selectAgentForCurrentIssue(this, agentName)
  await waitForAgentSessionStatus(this, 'completed')
})

When('我取消当前 Issue 的 Agent 委派', async function (this: CradleWorld) {
  const trigger = this.page.locator(DELEGATE_TRIGGER)
  await expect(trigger).toBeVisible({ timeout: 10_000 })
  await trigger.click()

  const unassignedOption = this.page.locator('[data-testid="issue-agent-option-unassigned"]')
  await expect(unassignedOption).toBeVisible({ timeout: 10_000 })
  await unassignedOption.click()
})

Then('当前 Issue 不应再显示 Agent 委派', async function (this: CradleWorld) {
  const trigger = this.page.locator(DELEGATE_TRIGGER)
  await expect(trigger).toHaveAttribute('data-agent-delegated', 'false', { timeout: 30_000 })
  await expect(trigger).toContainText('Unassigned', { timeout: 30_000 })
})
