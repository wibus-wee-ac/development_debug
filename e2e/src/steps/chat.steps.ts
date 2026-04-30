import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import { MockLlmServer } from '../support/mock-llm-server'
import type { CradleWorld } from '../support/world'

// ── Constants ─────────────────────────────────────────────────────────────────

const MOCK_RESPONSE = 'Hello from mock LLM! I am an AI assistant.'
const CHAT_VIEW_TIMEOUT = 15000
const MESSAGE_TIMEOUT = 20000

// ── Shared state ──────────────────────────────────────────────────────────────

let mockServer: MockLlmServer | null = null
let mockBaseUrl = ''

// ── Background steps ──────────────────────────────────────────────────────────

Given('应用已启动', async function (this: CradleWorld) {
  console.warn('[step] assert app is launched')
  // The Before hook already launched the app — just verify page is alive
  await this.page.waitForLoadState('domcontentloaded')
})

Given('我已配置 Mock LLM Provider', async function (this: CradleWorld) {
  console.warn('[step] configure mock LLM provider')

  // Start mock server if not running
  if (!mockServer) {
    mockServer = new MockLlmServer({ responseText: MOCK_RESPONSE, chunkDelay: 5 })
    mockBaseUrl = await mockServer.start()
    console.warn(`[mock-llm] listening at ${mockBaseUrl}`)
  }

  // Create an agent profile pointing to the mock server via renderer IPC
  // Use ipcRenderer.invoke directly since the IPC proxy may not be initialized yet
  await this.page.evaluate(async (baseUrl: string) => {
    // eslint-disable-next-line ts/no-explicit-any
    const ipcRenderer = (window as any).electron?.ipcRenderer
    if (!ipcRenderer?.invoke) {
      throw new Error('electron.ipcRenderer not available')
    }
    await ipcRenderer.invoke('agentRuntime.upsertProfile', {
      id: 'mock-llm-profile',
      name: 'Mock LLM',
      providerKind: 'openai-compatible',
      enabled: true,
      configJson: JSON.stringify({
        baseUrl,
        model: 'mock-model',
      }),
      credentialRef: null,
    })
  }, mockBaseUrl)
})

// ── Navigation ────────────────────────────────────────────────────────────────

When('我点击"新建聊天"导航项', async function (this: CradleWorld) {
  console.warn('[step] click new-chat nav item')
  const navItem = this.page.locator('[data-testid="nav-new-chat"]')
  await expect(navItem).toBeVisible({ timeout: 15000 })
  await navItem.click()
})

Given('我已导航到新建聊天页面', async function (this: CradleWorld) {
  console.warn('[step] navigate to new-chat page')
  const navItem = this.page.locator('[data-testid="nav-new-chat"]')
  await expect(navItem).toBeVisible({ timeout: 15000 })
  await navItem.click()
  const page = this.page.locator('[data-testid="new-chat-page"]')
  await expect(page).toBeVisible({ timeout: 10000 })
})

// ── New chat page assertions ──────────────────────────────────────────────────

Then('我应该看到新建聊天页面', async function (this: CradleWorld) {
  console.warn('[step] assert new-chat page visible')
  const page = this.page.locator('[data-testid="new-chat-page"]')
  await expect(page).toBeVisible({ timeout: 10000 })
})

Then('聊天输入框应可见', async function (this: CradleWorld) {
  console.warn('[step] assert new-chat textarea visible')
  const textarea = this.page.locator('[data-testid="new-chat-textarea"]')
  await expect(textarea).toBeVisible({ timeout: 5000 })
})

// ── New-chat input & send ─────────────────────────────────────────────────────

When('我在新建聊天输入框中输入{string}', async function (this: CradleWorld, text: string) {
  console.warn(`[step] type in new-chat textarea: ${text}`)
  const textarea = this.page.locator('[data-testid="new-chat-textarea"]')
  await expect(textarea).toBeVisible({ timeout: 5000 })
  await textarea.fill(text)
})

When('我点击发送按钮', async function (this: CradleWorld) {
  console.warn('[step] click new-chat send button')
  const btn = this.page.locator('[data-testid="new-chat-send-btn"]')
  await expect(btn).toBeEnabled({ timeout: 5000 })
  await btn.click()
})

// ── Chat view assertions ──────────────────────────────────────────────────────

Then('应该跳转到聊天视图', async function (this: CradleWorld) {
  console.warn('[step] assert chat-view is visible')
  const chatView = this.page.locator('[data-testid="chat-view"]')
  await expect(chatView).toBeVisible({ timeout: CHAT_VIEW_TIMEOUT })
})

Then('我应该看到用户消息{string}', async function (this: CradleWorld, text: string) {
  console.warn(`[step] assert user message: ${text}`)
  const userBubble = this.page.locator('[data-testid="message-bubble-user"]').filter({ hasText: text })
  await expect(userBubble).toBeAttached({ timeout: MESSAGE_TIMEOUT })
})

Then('我应该看到 AI 回复消息', async function (this: CradleWorld) {
  console.warn('[step] assert assistant message visible')
  // The assistant bubble lives inside virtua's Virtualizer which wraps items in
  // container divs that may mark children as hidden when outside the scroll viewport.
  // Assert the element exists in the DOM (attached) rather than pixel-visible.
  const assistantBubble = this.page.locator('[data-testid="message-bubble-assistant"]')
  await expect(assistantBubble.first()).toBeAttached({ timeout: MESSAGE_TIMEOUT })
  // Additionally verify that the mock response text appeared somewhere on the page
  await expect(this.page.locator('text=Hello from mock LLM')).toBeAttached({ timeout: 5000 })
})

// ── Composite setup steps ─────────────────────────────────────────────────────

Given('我已在新建聊天页面发送了初始消息', async function (this: CradleWorld) {
  console.warn('[step] setup: navigate to new-chat and send initial message')

  // Navigate to new-chat page
  const navItem = this.page.locator('[data-testid="nav-new-chat"]')
  await expect(navItem).toBeVisible({ timeout: 15000 })
  await navItem.click()
  const page = this.page.locator('[data-testid="new-chat-page"]')
  await expect(page).toBeVisible({ timeout: 10000 })

  // Type and send
  const textarea = this.page.locator('[data-testid="new-chat-textarea"]')
  await expect(textarea).toBeVisible({ timeout: 5000 })
  await textarea.fill('初始测试消息')

  const btn = this.page.locator('[data-testid="new-chat-send-btn"]')
  await expect(btn).toBeEnabled({ timeout: 5000 })
  await btn.click()

  // Wait for chat view + assistant reply
  const chatView = this.page.locator('[data-testid="chat-view"]')
  await expect(chatView).toBeVisible({ timeout: CHAT_VIEW_TIMEOUT })
  const assistantBubble = this.page.locator('[data-testid="message-bubble-assistant"]')
  await expect(assistantBubble.first()).toBeAttached({ timeout: MESSAGE_TIMEOUT })
})

// ── Chat view composer ────────────────────────────────────────────────────────

When('我在聊天输入框中输入{string}', async function (this: CradleWorld, text: string) {
  console.warn(`[step] type in chat composer: ${text}`)
  const textarea = this.page.locator('[data-testid="chat-composer-textarea"]')
  await expect(textarea).toBeVisible({ timeout: 5000 })
  await textarea.fill(text)
})

When('我点击聊天发送按钮', async function (this: CradleWorld) {
  console.warn('[step] click chat send button')
  const btn = this.page.locator('[data-testid="chat-send-btn"]')
  await expect(btn).toBeEnabled({ timeout: 5000 })
  await btn.click()
})

// ── Session sidebar ───────────────────────────────────────────────────────────

Then('侧栏应显示至少一个会话项', async function (this: CradleWorld) {
  console.warn('[step] assert sidebar has at least one session item')
  const sessionItems = this.page.locator('[data-testid^="session-item-"]')
  await expect(sessionItems.first()).toBeVisible({ timeout: 10000 })
})
