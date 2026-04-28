import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world.ts'

const EMPTY_STATE_RE = /还没有 Agent Profile|No agent profiles/

When('我点击设置按钮', async function (this: CradleWorld) {
  console.warn('[step] click settings button')
  const btn = this.page.locator('[data-testid="settings-btn"]')
  await expect(btn).toBeVisible({ timeout: 15000 })
  await btn.click()
})

When('我点击"Providers"导航项', async function (this: CradleWorld) {
  console.warn('[step] click Providers nav item')
  const navItem = this.page.locator('[data-testid="settings-nav-providers"]')
  await expect(navItem).toBeVisible({ timeout: 5000 })
  await navItem.click()
})

Given('我已进入 Agent Runtime 设置页面', async function (this: CradleWorld) {
  console.warn('[step] navigate to Agent Runtime settings')
  const settingsBtn = this.page.locator('[data-testid="settings-btn"]')
  await expect(settingsBtn).toBeVisible({ timeout: 15000 })
  await settingsBtn.click()

  const navItem = this.page.locator('[data-testid="settings-nav-providers"]')
  await expect(navItem).toBeVisible({ timeout: 5000 })
  await navItem.click()

  const settings = this.page.locator('[data-testid="agent-runtime-settings"]')
  await expect(settings).toBeVisible({ timeout: 5000 })
})

Then('我应该看到 Agent Runtime 设置页面', async function (this: CradleWorld) {
  console.warn('[step] assert Agent Runtime settings visible')
  const settings = this.page.locator('[data-testid="agent-runtime-settings"]')
  await expect(settings).toBeVisible({ timeout: 10000 })
})

Then('我应该看到 Provider 类型选择', async function (this: CradleWorld) {
  console.warn('[step] assert provider kind selector visible')
  const selector = this.page.locator('[data-testid="agent-provider-kind"]')
  await expect(selector).toBeVisible({ timeout: 5000 })
})

Then('我应该看到 Agent Profile 列表或空状态', async function (this: CradleWorld) {
  console.warn('[step] assert profile list or empty state visible')
  const settings = this.page.locator('[data-testid="agent-runtime-settings"]')
  await expect(settings).toBeVisible({ timeout: 5000 })

  const profileList = this.page.locator('[data-testid="agent-profile-list"]')
  const emptyText = settings.getByText(EMPTY_STATE_RE)

  const hasProfiles = await profileList.isVisible().catch(() => false)
  const hasEmpty = await emptyText.isVisible().catch(() => false)

  expect(hasProfiles || hasEmpty).toBeTruthy()
})
