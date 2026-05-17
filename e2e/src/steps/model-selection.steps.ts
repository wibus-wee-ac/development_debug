// Input: Cucumber step bindings, Playwright assertions, CradleWorld helpers
// Output: Model/Agent selection E2E step definitions covering agent picker and send-with-agent flows
// Position: E2E step layer for model-selection.feature

import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world'

const SELECTOR_TIMEOUT = 15_000
const MOCK_RE = /mock/i

When('我进入新会话页面', async function (this: CradleWorld) {
  const navItem = this.page.locator('[data-testid="nav-new-chat"]')
  await expect(navItem).toBeVisible({ timeout: 15_000 })
  await navItem.click()
  await expect(this.page.locator('[data-testid="new-chat-page"]')).toBeVisible({ timeout: 10_000 })
})

When('我打开 Agent 选择器', async function (this: CradleWorld) {
  const selector = this.page.locator('[data-testid="new-chat-agent-selector"]')
  await expect(selector).toBeVisible({ timeout: SELECTOR_TIMEOUT })
  await selector.click()
})

Then('应该看到可用的 Agent 列表', async function (this: CradleWorld) {
  // The menu popup should be visible with at least one menuitem
  const menuPopup = this.page.locator('[role="menu"]')
  await expect(menuPopup).toBeVisible({ timeout: SELECTOR_TIMEOUT })

  const items = menuPopup.locator('[role="menuitem"]')
  await expect(items.first()).toBeVisible({ timeout: SELECTOR_TIMEOUT })
})

When('我选择 Mock LLM Agent', async function (this: CradleWorld) {
  // Open selector if not already open
  const menuPopup = this.page.locator('[role="menu"]')
  const isListVisible = await menuPopup.isVisible().catch(() => false)
  if (!isListVisible) {
    const selector = this.page.locator('[data-testid="new-chat-agent-selector"]')
    await expect(selector).toBeVisible({ timeout: SELECTOR_TIMEOUT })
    await selector.click()
    await expect(menuPopup).toBeVisible({ timeout: SELECTOR_TIMEOUT })
  }

  // Click the mock LLM profile item (contains "Mock" or the mock profile name)
  const mockItem = menuPopup.locator('[role="menuitem"]', { hasText: MOCK_RE })
  await expect(mockItem.first()).toBeVisible({ timeout: 10_000 })
  await mockItem.first().click()
})

When('我发送消息{string}', async function (this: CradleWorld, text: string) {
  const textarea = this.page.locator('[data-testid="new-chat-textarea"]')
  await expect(textarea).toBeVisible({ timeout: 10_000 })
  await textarea.click()
  await textarea.fill(text)

  const button = this.page.locator('[data-testid="new-chat-send-btn"]')

  // If button is still disabled after a short wait, reload to pick up fresh query data
  const isEnabled = await button.isEnabled().catch(() => false)
  if (!isEnabled) {
    await this.page.waitForTimeout(500)
    const stillDisabled = !(await button.isEnabled().catch(() => false))
    if (stillDisabled) {
      // Reload page and re-navigate to new-chat
      await this.page.reload({ waitUntil: 'domcontentloaded' })
      const navItem = this.page.locator('[data-testid="nav-new-chat"]')
      await expect(navItem).toBeVisible({ timeout: 15_000 })
      await navItem.click()
      await expect(this.page.locator('[data-testid="new-chat-page"]')).toBeVisible({ timeout: 10_000 })

      // Re-select agent
      const selector = this.page.locator('[data-testid="new-chat-agent-selector"]')
      await expect(selector).toBeVisible({ timeout: 10_000 })
      await selector.click()
      const menuPopup = this.page.locator('[role="menu"]')
      await expect(menuPopup).toBeVisible({ timeout: 10_000 })
      const mockItem = menuPopup.locator('[role="menuitem"]', { hasText: MOCK_RE })
      await expect(mockItem.first()).toBeVisible({ timeout: 10_000 })
      await mockItem.first().click()

      // Re-fill text
      const ta = this.page.locator('[data-testid="new-chat-textarea"]')
      await ta.click()
      await ta.fill(text)
    }
  }

  await expect(button).toBeEnabled({ timeout: 15_000 })
  await button.click()
})

Then('应该收到 Agent 的回复', async function (this: CradleWorld) {
  // Wait for chat view to appear and reach idle status
  const chatView = this.page.locator('[data-tab-visible="true"] [data-testid="chat-view"]').first()
  await expect(chatView).toBeVisible({ timeout: 20_000 })
  await expect(chatView).toHaveAttribute('data-chat-status', 'idle', { timeout: 30_000 })

  // Verify an assistant message bubble is visible
  const assistantBubble = this.page.locator('[data-testid="message-bubble-assistant"]').last()
  await expect(assistantBubble).toBeVisible({ timeout: 10_000 })
})
