// Input: Cucumber step bindings, Playwright assertions, CradleWorld helpers
// Output: Home dashboard E2E step definitions covering dashboard visibility and recent session navigation
// Position: E2E step layer for home-dashboard.feature

import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world'

const DASHBOARD_TIMEOUT = 15_000

Given('存在至少一个会话', async function (this: CradleWorld) {
  // Reload to pick up fresh profile/workspace data after mock setup
  await this.page.reload({ waitUntil: 'domcontentloaded' })

  // Create a session by sending a message through the new-chat flow
  const navItem = this.page.locator('[data-testid="nav-new-chat"]')
  await expect(navItem).toBeVisible({ timeout: 15_000 })
  await navItem.click()
  await expect(this.page.locator('[data-testid="new-chat-page"]')).toBeVisible({ timeout: 10_000 })

  // Select the mock LLM provider from the agent selector
  const agentSelector = this.page.locator('[data-testid="new-chat-agent-selector"]')
  await expect(agentSelector).toBeVisible({ timeout: 10_000 })
  await agentSelector.click()
  const menuPopup = this.page.locator('[role="menu"]')
  await expect(menuPopup).toBeVisible({ timeout: 10_000 })
  const mockItem = menuPopup.locator('[role="menuitem"]', { hasText: /mock/i })
  await expect(mockItem.first()).toBeVisible({ timeout: 10_000 })
  await mockItem.first().click()

  const textarea = this.page.locator('[data-testid="new-chat-textarea"]')
  await expect(textarea).toBeVisible({ timeout: 10_000 })
  await textarea.click()
  await textarea.fill('测试会话消息')

  const button = this.page.locator('[data-testid="new-chat-send-btn"]')
  await expect(button).toBeEnabled({ timeout: 15_000 })
  await button.click()

  // Wait for chat to complete
  const chatView = this.page.locator('[data-tab-visible="true"] [data-testid="chat-view"]').first()
  await expect(chatView).toBeVisible({ timeout: 20_000 })
  await expect(chatView).toHaveAttribute('data-chat-status', 'idle', { timeout: 30_000 })

  // Navigate back to home
  const homeNav = this.page.locator('[data-testid="nav-home"]')
  await expect(homeNav).toBeVisible({ timeout: 10_000 })
  await homeNav.click()
})

When('我点击最近会话卡片', async function (this: CradleWorld) {
  const card = this.page.locator('[data-testid="home-recent-session"]').first()
  await expect(card).toBeVisible({ timeout: DASHBOARD_TIMEOUT })
  await card.click()
})

Then('我应该看到首页仪表盘', async function (this: CradleWorld) {
  const dashboard = this.page.locator('[data-testid="home-dashboard"]')
  await expect(dashboard).toBeVisible({ timeout: DASHBOARD_TIMEOUT })
})

Then('应该切换到对应的聊天标签页', async function (this: CradleWorld) {
  const chatView = this.page.locator('[data-tab-visible="true"] [data-testid="chat-view"]').first()
  await expect(chatView).toBeVisible({ timeout: 20_000 })
})
