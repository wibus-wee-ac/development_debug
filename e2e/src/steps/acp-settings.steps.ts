import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world.ts'

// ── Constants ─────────────────────────────────────────────────────────────────

const EMPTY_STATE_RE = /注册表为空|没有找到/

// ── Navigation ────────────────────────────────────────────────────────────────

When('我点击设置按钮', async function (this: CradleWorld) {
  console.warn('[step] click settings button')
  const btn = this.page.locator('[data-testid="settings-btn"]')
  await expect(btn).toBeVisible({ timeout: 15000 })
  await btn.click()
})

When('我点击"代理 \\(ACP\\)"导航项', async function (this: CradleWorld) {
  console.warn('[step] click ACP nav item')
  const navItem = this.page.locator('[data-testid="settings-nav-acp"]')
  await expect(navItem).toBeVisible({ timeout: 5000 })
  await navItem.click()
})

Given('我已进入 ACP 设置页面', async function (this: CradleWorld) {
  console.warn('[step] navigate to ACP settings')
  const settingsBtn = this.page.locator('[data-testid="settings-btn"]')
  await expect(settingsBtn).toBeVisible({ timeout: 15000 })
  await settingsBtn.click()

  const navItem = this.page.locator('[data-testid="settings-nav-acp"]')
  await expect(navItem).toBeVisible({ timeout: 5000 })
  await navItem.click()

  const acpSettings = this.page.locator('[data-testid="acp-settings"]')
  await expect(acpSettings).toBeVisible({ timeout: 5000 })
})

// ── Assertions ────────────────────────────────────────────────────────────────

Then('我应该看到 ACP 设置页面', async function (this: CradleWorld) {
  console.warn('[step] assert ACP settings visible')
  const acpSettings = this.page.locator('[data-testid="acp-settings"]')
  await expect(acpSettings).toBeVisible({ timeout: 10000 })
})

Then('我应该看到搜索框', async function (this: CradleWorld) {
  console.warn('[step] assert search input visible')
  const input = this.page.locator('[data-testid="acp-search-input"]')
  await expect(input).toBeVisible({ timeout: 5000 })
})

Then('我应该看到代理列表或空状态', async function (this: CradleWorld) {
  console.warn('[step] assert agent list or empty state visible')
  // Either the agent list appears or some loading/empty indicator —
  // we wait for loading to finish (spinner disappears or list shows)
  const acpSettings = this.page.locator('[data-testid="acp-settings"]')
  await expect(acpSettings).toBeVisible({ timeout: 5000 })

  // Wait for loading to complete — check that spinner is gone or list is present
  const spinner = acpSettings.locator('[data-slot="spinner"]')
  await expect(spinner).toBeHidden({ timeout: 30000 })

  // After loading, either agent list or empty state text should exist
  const agentList = this.page.locator('[data-testid="acp-agent-list"]')
  const emptyText = acpSettings.getByText(EMPTY_STATE_RE)

  const hasAgents = await agentList.isVisible().catch(() => false)
  const hasEmpty = await emptyText.isVisible().catch(() => false)

  expect(hasAgents || hasEmpty).toBeTruthy()
})
