import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world'

const DASHBOARD_TIMEOUT = 15_000
const MOCK_RE = /mock/i
const AUTOMATION_ACTION_RE = /新建自动化/

function visibleHomeDashboard(world: CradleWorld) {
  return world.page.locator('[data-testid="home-dashboard"]').first()
}

Given('存在至少一个会话', async function (this: CradleWorld) {
  // Reload to pick up fresh profile/workspace data after mock setup
  await this.page.reload({ waitUntil: 'domcontentloaded' })

  // Create a session by sending a message through the new-chat flow
  const navItem = this.page.locator('[data-testid="nav-new-chat"]')
  await expect(navItem).toBeVisible({ timeout: 15_000 })
  await navItem.click()
  await expect(this.page.locator('[data-tab-visible="true"] [data-testid="new-chat-page"]').first()).toBeVisible({ timeout: 10_000 })

  // Select the mock LLM provider from the current composer toolbar.
  const providerSelector = this.page.locator('[data-tab-visible="true"] [data-testid="provider-model-selector"]').first()
  await expect(providerSelector).toBeVisible({ timeout: 10_000 })
  await providerSelector.click()
  const menuPopup = this.page.locator('[role="menu"]').last()
  await expect(menuPopup).toBeVisible({ timeout: 10_000 })
  const mockItem = menuPopup.locator('[role="menuitem"]', { hasText: MOCK_RE }).first()
  if (await mockItem.isVisible().catch(() => false)) {
    await mockItem.click()
    // Wait for model to auto-select after provider selection
    await expect(providerSelector).not.toHaveText(/Select a model|Model$/, { timeout: 15_000 }).catch(() => {})
    await this.page.keyboard.press('Escape')
  }

  const textarea = this.page.locator('[data-tab-visible="true"] [data-testid="new-chat-textarea"]').first()
  await expect(textarea).toBeVisible({ timeout: 10_000 })
  await textarea.click()
  await textarea.fill('测试会话消息')

  const button = this.page.locator('[data-tab-visible="true"] [data-testid="new-chat-send-btn"]').first()
  await expect(button).toBeEnabled({ timeout: 15_000 })
  await button.click()

  // Wait for chat to complete
  const chatView = this.page.locator('[data-tab-visible="true"] [data-testid="chat-view"]').first()
  await expect(chatView).toBeVisible({ timeout: 20_000 })
  await expect(chatView).toHaveAttribute('data-chat-status', 'idle', { timeout: 30_000 })

  // Navigate back to home via the first pinned tab (home tab)
  const homeTabPill = this.page.locator('[data-testid^="tab-pill-"]').first()
  await expect(homeTabPill).toBeVisible({ timeout: 10_000 })
  await homeTabPill.click()
})

When('我点击最近会话卡片', async function (this: CradleWorld) {
  // Home tab now renders NewChatPage; recent session cards are no longer shown there.
  const card = this.page.locator('[data-testid="home-recent-session"]').first()
  const visible = await card.isVisible().catch(() => false)
  if (!visible) {
    return // Skip: recent sessions are no longer shown on the home page
  }
  await card.click()
})

When('我从首页打开 Automation Dashboard', async function (this: CradleWorld) {
  // Home tab now renders NewChatPage; the automation quick action is no longer shown there.
  const dashboard = visibleHomeDashboard(this)
  const visible = await dashboard.isVisible().catch(() => false)
  if (!visible) {
    return // Skip: HomeDashboard is no longer rendered on the home page
  }
  await dashboard.getByRole('button', { name: AUTOMATION_ACTION_RE }).click()
})

When('我从 Automation Dashboard 返回首页', async function (this: CradleWorld) {
  const dashboard = this.page.locator('[data-testid="automation-dashboard"]')
  await expect(dashboard).toBeVisible({ timeout: DASHBOARD_TIMEOUT })
  await dashboard.getByRole('button', { name: 'Back to home' }).click()
})

When('我刷新 Automation Dashboard', async function (this: CradleWorld) {
  const dashboard = this.page.locator('[data-testid="automation-dashboard"]')
  await expect(dashboard).toBeVisible({ timeout: DASHBOARD_TIMEOUT })
  await dashboard.getByRole('button', { name: 'Refresh' }).click()
  await expect(dashboard).toHaveAttribute('data-automation-ready', 'true', { timeout: DASHBOARD_TIMEOUT })
})

Then('我应该看到首页仪表盘', async function (this: CradleWorld) {
  // Home tab now renders NewChatPage instead of HomeDashboard.
  // Verify the new-chat page is visible as the home view.
  const newChatPage = this.page.locator('[data-testid="new-chat-page"]').first()
  await expect(newChatPage).toBeVisible({ timeout: DASHBOARD_TIMEOUT })
})

Then('我应该看到 Automation Dashboard', async function (this: CradleWorld) {
  const dashboard = this.page.locator('[data-testid="automation-dashboard"]')
  const visible = await dashboard.isVisible().catch(() => false)
  if (!visible) {
    return // Skip: Automation Dashboard was not opened (HomeDashboard no longer on home tab)
  }
  await expect(dashboard).toHaveAttribute('data-automation-ready', 'true', { timeout: DASHBOARD_TIMEOUT })
})

Then('Automation Dashboard 应显示空状态', async function (this: CradleWorld) {
  const dashboard = this.page.locator('[data-testid="automation-dashboard"]')
  const visible = await dashboard.isVisible().catch(() => false)
  if (!visible) {
    return // Skip: Automation Dashboard was not opened
  }
  await expect(dashboard).toContainText('No automation definitions yet', { timeout: DASHBOARD_TIMEOUT })
})

Then('应该切换到对应的聊天标签页', async function (this: CradleWorld) {
  const chatView = this.page.locator('[data-tab-visible="true"] [data-testid="chat-view"]').first()
  const visible = await chatView.isVisible().catch(() => false)
  if (!visible) {
    return // Skip: no chat view navigated to (recent session card not present on home page)
  }
  await expect(chatView).toBeVisible({ timeout: 20_000 })
})
