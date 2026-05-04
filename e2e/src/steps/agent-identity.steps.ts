import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world.ts'

const AGENT_CREATE_PAGE = '[data-testid="agent-create"]'
const AGENT_NAME_INPUT = '[data-testid="agent-detail-name"]'

// ── Navigation ────────────────────────────────────────────────────────────────

When('我点击"Agents"导航项', async function (this: CradleWorld) {
  console.warn('[step] click Agents nav item')
  const navItem = this.page.locator('[data-testid="settings-nav-agents"]')
  await expect(navItem).toBeVisible({ timeout: 5000 })
  await navItem.click()
})

Given('我已进入 Agent 列表页面', async function (this: CradleWorld) {
  console.warn('[step] navigate to Agent list settings')
  const settingsBtn = this.page.locator('[data-testid="settings-btn"]')
  await expect(settingsBtn).toBeVisible({ timeout: 15000 })
  await settingsBtn.click()

  const navItem = this.page.locator('[data-testid="settings-nav-agents"]')
  await expect(navItem).toBeVisible({ timeout: 5000 })
  await navItem.click()

  const agentList = this.page.locator('[data-testid="agent-list"]')
  await expect(agentList).toBeVisible({ timeout: 5000 })
})

Then('我应该看到 Agent 列表页面', async function (this: CradleWorld) {
  console.warn('[step] assert Agent list visible')
  const agentList = this.page.locator('[data-testid="agent-list"]')
  await expect(agentList).toBeVisible({ timeout: 10000 })
})

// ── Empty state ───────────────────────────────────────────────────────────────

Then('我应该看到 Agent 空状态提示', async function (this: CradleWorld) {
  console.warn('[step] assert Agent empty state visible')
  const emptyState = this.page.locator('[data-testid="agent-empty-state"]')
  await expect(emptyState).toBeVisible({ timeout: 5000 })
})

// ── Create form ───────────────────────────────────────────────────────────────

When('我点击"New Agent"按钮', async function (this: CradleWorld) {
  console.warn('[step] click New Agent button')
  const btn = this.page.locator('[data-testid="new-agent-btn"]')
  await expect(btn).toBeVisible({ timeout: 5000 })
  await btn.click()
})

Given('我已打开 Agent 创建页面', async function (this: CradleWorld) {
  console.warn('[step] open Agent create page')
  const btn = this.page.locator('[data-testid="new-agent-btn"]')
  await expect(btn).toBeVisible({ timeout: 5000 })
  await btn.click()

  await expect(this.page.locator(AGENT_CREATE_PAGE)).toBeVisible({ timeout: 5000 })
  const nameInput = this.page.locator(AGENT_NAME_INPUT)
  await expect(nameInput).toBeVisible({ timeout: 5000 })
})

Then('我应该看到 Agent 创建页面', async function (this: CradleWorld) {
  console.warn('[step] assert Agent create page visible')
  await expect(this.page.locator(AGENT_CREATE_PAGE)).toBeVisible({ timeout: 5000 })
  const nameInput = this.page.locator(AGENT_NAME_INPUT)
  await expect(nameInput).toBeVisible({ timeout: 5000 })
})

// ── Avatar ────────────────────────────────────────────────────────────────────

Then('我应该看到 DiceBear 头像预览', async function (this: CradleWorld) {
  console.warn('[step] assert DiceBear avatar preview visible')
  const avatar = this.page.locator(`${AGENT_CREATE_PAGE} img`).first()
  await expect(avatar).toBeVisible({ timeout: 5000 })
  const src = await avatar.getAttribute('src')
  expect(src).toContain('dicebear.com')
})
