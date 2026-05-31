import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world'

const SELECTOR_TIMEOUT = 15_000
const MOCK_RE = /mock/i
const RUNTIME_LABELS = ['Standard', 'Claude Agent', 'Codex', 'CLI TUI'] as const

async function openProviderModelSelector(world: CradleWorld) {
  const selector = world.page.locator('[data-tab-visible="true"] [data-testid="provider-model-selector"]').first()
  await expect(selector).toBeVisible({ timeout: SELECTOR_TIMEOUT })
  await selector.click()

  const menuPopup = world.page.locator('[role="menu"]').last()
  await expect(menuPopup).toBeVisible({ timeout: SELECTOR_TIMEOUT })
  return menuPopup
}

async function selectMockLlmProvider(world: CradleWorld) {
  const menuPopup = await openProviderModelSelector(world)
  const mockItem = menuPopup.locator('[role="menuitem"]', { hasText: MOCK_RE }).first()
  await expect(mockItem).toBeVisible({ timeout: SELECTOR_TIMEOUT })
  await mockItem.click()

  // After selecting provider, models load asynchronously and auto-select.
  // Wait for the trigger text to update from placeholder to actual model name.
  const trigger = world.page.locator('[data-tab-visible="true"] [data-testid="provider-model-selector"]').first()
  await expect(trigger).not.toHaveText(/Select a model|Model$/, { timeout: 15_000 }).catch(() => {})
  await world.page.keyboard.press('Escape')
}

When('我进入新会话页面', async function (this: CradleWorld) {
  const navItem = this.page.locator('[data-testid="nav-new-chat"]')
  await expect(navItem).toBeVisible({ timeout: 15_000 })
  await navItem.click()
  await expect(this.page.locator('[data-tab-visible="true"] [data-testid="new-chat-page"]').first()).toBeVisible({ timeout: 10_000 })
})

When('我打开 Provider 与模型选择器', async function (this: CradleWorld) {
  await openProviderModelSelector(this)
})

Then('应该看到可用的 Provider 列表', async function (this: CradleWorld) {
  const menuPopup = this.page.locator('[role="menu"]').last()
  await expect(menuPopup).toBeVisible({ timeout: SELECTOR_TIMEOUT })

  const mockProvider = menuPopup.locator('[role="menuitem"]', { hasText: MOCK_RE }).first()
  await expect(mockProvider).toBeVisible({ timeout: SELECTOR_TIMEOUT })
})

When('我选择 Mock LLM Provider', async function (this: CradleWorld) {
  await selectMockLlmProvider(this)
})

When('我发送消息{string}', async function (this: CradleWorld, text: string) {
  const textarea = this.page.locator('[data-tab-visible="true"] [data-testid="new-chat-textarea"]').first()
  await expect(textarea).toBeVisible({ timeout: 10_000 })
  await textarea.click()
  await textarea.fill(text)

  const button = this.page.locator('[data-tab-visible="true"] [data-testid="new-chat-send-btn"]').first()

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
      await expect(this.page.locator('[data-tab-visible="true"] [data-testid="new-chat-page"]').first()).toBeVisible({ timeout: 10_000 })

      await selectMockLlmProvider(this)

      const ta = this.page.locator('[data-tab-visible="true"] [data-testid="new-chat-textarea"]').first()
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

Then('Provider 与模型选择器应显示模型{string}', async function (this: CradleWorld, model: string) {
  const selector = this.page.locator('[data-tab-visible="true"] [data-testid="provider-model-selector"]').first()
  await expect(selector).toBeVisible({ timeout: SELECTOR_TIMEOUT })
  // Model loads lazily after provider selection — poll until it appears
  await expect.poll(async () => {
    const text = await selector.innerText().catch(() => '')
    return text.includes(model) ? true : text
  }, { timeout: 30_000, message: `Expected selector to contain "${model}"` }).toBe(true)
})

When('我打开运行时选择器', async function (this: CradleWorld) {
  const selector = this.page.locator('[data-tab-visible="true"] [data-testid="runtime-selector"]').first()
  await expect(selector).toBeVisible({ timeout: SELECTOR_TIMEOUT })
  await selector.click()
})

Then('应该看到可用的运行时列表', async function (this: CradleWorld) {
  const menuPopup = this.page.locator('[role="menu"]').last()
  await expect(menuPopup).toBeVisible({ timeout: SELECTOR_TIMEOUT })

  for (const label of RUNTIME_LABELS) {
    await expect(menuPopup.locator('[role="menuitem"]', { hasText: label })).toBeVisible({ timeout: SELECTOR_TIMEOUT })
  }
})
