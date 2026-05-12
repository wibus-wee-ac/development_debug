// Input: Cucumber step bindings, Playwright assertions, deterministic mock LLM responses, and shared UI helpers
// Output: Chat-focused E2E step definitions covering visible chat journeys, session menu actions, reasoning/tool-call UI, and stream lifecycle
// Position: E2E step layer for chat.feature, focused on user-visible chat behavior rather than backend persistence contracts

import type { DataTable } from '@cucumber/cucumber'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { MockToolCall } from '../support/mock-llm-server'
import type { CradleWorld } from '../support/world'

const DEFAULT_RESPONSE = 'Hello from mock LLM! I am an AI assistant.'
const SLOW_RESPONSE = Array.from({ length: 30 }).fill('Hello from mock LLM!').join(' ')
const CONTEXT_RESPONSES = [
  '第一轮助手回复：我记住了苹果。',
  '第二轮助手回复：我记住了香蕉。',
  '第三轮助手回复：你先让我记住苹果，又让我记住香蕉。',
]
const MARKDOWN_RESPONSE = 'Markdown 导出助手回复：请复制我。'
const REASONING_TEXT = '第一步分析问题\n第二步形成答案'
const TOOL_CALLS: MockToolCall[] = [{
  id: 'mock-tool-call-1',
  type: 'function',
  function: {
    name: 'read_file',
    arguments: '{"path":"demo.txt"}',
  },
}]
const CHAT_VIEW_TIMEOUT = 20_000
const CHAT_STATUS_TIMEOUT = 30_000
const SESSION_ALIASES_KEY = 'chat.session-aliases'

type SessionAlias = {
  id: string
  firstUserText: string
}

function recallSessionAliases(world: CradleWorld): Record<string, SessionAlias> {
  return world.maybeRecall<Record<string, SessionAlias>>(SESSION_ALIASES_KEY) ?? {}
}

function rememberSessionAlias(world: CradleWorld, alias: string, session: SessionAlias): void {
  const aliases = recallSessionAliases(world)
  aliases[alias] = session
  world.remember(SESSION_ALIASES_KEY, aliases)
}

function recallSessionAlias(world: CradleWorld, alias: string): SessionAlias {
  const session = recallSessionAliases(world)[alias]

  if (!session) {
    throw new Error(`Missing remembered chat session alias: ${alias}`)
  }

  return session
}

async function getChatView(world: CradleWorld) {
  // ALL tabs are rendered via React 19 Activity; only the active tab has data-tab-visible="true".
  // We wait until the active tab's content contains a chat-view.
  // This handles the timing lag between clicking send and openTab() switching the active tab.
  const chatView = world.page.locator('[data-tab-visible="true"] [data-testid="chat-view"]').first()
  await expect(chatView).toBeVisible({ timeout: CHAT_VIEW_TIMEOUT })
  return chatView
}

async function waitForChatStatus(world: CradleWorld, status: string) {
  const chatView = await getChatView(world)
  await expect(chatView).toHaveAttribute('data-chat-status', status, { timeout: CHAT_STATUS_TIMEOUT })
  return chatView
}

async function getCurrentChatSessionId(world: CradleWorld): Promise<string> {
  const chatView = await getChatView(world)
  const sessionId = await chatView.getAttribute('data-chat-session-id')
  if (!sessionId) {
    throw new Error('Expected active chat view to expose a chat session id')
  }
  return sessionId
}

async function getLastAssistantBubble(world: CradleWorld) {
  const locator = world.page.locator('[data-testid="message-bubble-assistant"]').last()
  await expect(locator).toBeVisible({ timeout: CHAT_STATUS_TIMEOUT })
  return locator
}

async function navigateToNewChat(world: CradleWorld): Promise<void> {
  console.warn('[step] navigate to new-chat page')
  const navItem = world.page.locator('[data-testid="nav-new-chat"]')
  await expect(navItem).toBeVisible({ timeout: 15_000 })
  await navItem.click()
  await expect(world.page.locator('[data-testid="new-chat-page"]')).toBeVisible({ timeout: 10_000 })
}

async function configureDefaultMockProvider(world: CradleWorld): Promise<void> {
  console.warn('[step] configure default mock LLM provider')
  await world.configureMockLlmProvider({
    responseText: DEFAULT_RESPONSE,
    chunkDelay: 5,
  })
}

async function configureSlowMockProvider(world: CradleWorld): Promise<void> {
  console.warn('[step] configure slow mock LLM provider')
  await world.configureMockLlmProvider({
    responseText: SLOW_RESPONSE,
    chunkDelay: 120,
  })
}

async function configureContextMockProvider(world: CradleWorld): Promise<void> {
  console.warn('[step] configure multi-turn context mock LLM provider')
  await world.configureMockLlmProvider({
    responseTexts: CONTEXT_RESPONSES,
    chunkDelay: 5,
  })
}

async function configureMarkdownExportMockProvider(world: CradleWorld): Promise<void> {
  console.warn('[step] configure markdown export mock LLM provider')
  await world.configureMockLlmProvider({
    responseText: MARKDOWN_RESPONSE,
    chunkDelay: 5,
  })
}

async function configureReasoningMockProvider(world: CradleWorld): Promise<void> {
  console.warn('[step] configure reasoning mock LLM provider')
  await world.configureMockLlmProvider({
    responseText: DEFAULT_RESPONSE,
    reasoningText: REASONING_TEXT,
    chunkDelay: 5,
  })
}

async function configureToolCallMockProvider(world: CradleWorld): Promise<void> {
  console.warn('[step] configure tool-call mock LLM provider')
  await world.configureMockLlmProvider({
    toolCalls: TOOL_CALLS,
    chunkDelay: 5,
  })
}

async function configureFailingMockProvider(world: CradleWorld): Promise<void> {
  console.warn('[step] configure failing mock LLM provider')
  await world.configureMockLlmProvider({
    failureMode: 'http-error',
    errorStatusCode: 503,
    errorMessage: 'Mock LLM forced failure',
  })
}

async function waitForSessionSidebarItem(world: CradleWorld, sessionId: string): Promise<void> {
  await expect(world.page.locator(`[data-testid="session-item-${sessionId}"]`)).toBeVisible({ timeout: 10_000 })
}

async function createRememberedSession(world: CradleWorld, alias: string, firstUserText: string): Promise<SessionAlias> {
  await navigateToNewChat(world)

  const textarea = world.page.locator('[data-testid="new-chat-textarea"]')
  await expect(textarea).toBeVisible({ timeout: 10_000 })
  await textarea.fill(firstUserText)

  const button = world.page.locator('[data-testid="new-chat-send-btn"]')
  await expect(button).toBeEnabled({ timeout: 10_000 })
  await button.click()

  await waitForChatStatus(world, 'idle')

  const session = {
    id: await getCurrentChatSessionId(world),
    firstUserText,
  }

  rememberSessionAlias(world, alias, session)
  await waitForSessionSidebarItem(world, session.id)
  return session
}

async function openSessionMenu(world: CradleWorld, sessionId: string): Promise<void> {
  const item = world.page.locator(`[data-testid="session-item-${sessionId}"]`)
  await expect(item).toBeVisible({ timeout: 10_000 })
  await item.hover()

  const trigger = world.page.locator(`[data-testid="session-menu-trigger-${sessionId}"]`)
  await expect(trigger).toBeVisible({ timeout: 10_000 })
  await trigger.click()
}

async function clickSessionMenuAction(world: CradleWorld, sessionId: string, action: 'toggle-pin' | 'copy-markdown' | 'delete' | 'rename'): Promise<void> {
  const locator = world.page.locator(`[data-testid="session-menu-${action}-${sessionId}"]`)
  await expect(locator).toBeVisible({ timeout: 10_000 })
  await locator.click()
}

async function getVisibleSessionOrder(world: CradleWorld): Promise<string[]> {
  return world.page.locator('[data-testid^="session-item-"]').evaluateAll((elements) => {
    return elements
      .map(element => element.getAttribute('data-testid')?.replace('session-item-', ''))
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
  })
}

async function readBrowserClipboardText(world: CradleWorld): Promise<string> {
  return world.page.evaluate(() => navigator.clipboard.readText())
}

async function getLastAssistantReasoningToggle(world: CradleWorld) {
  const assistantBubble = await getLastAssistantBubble(world)
  const toggle = assistantBubble.locator('[data-testid="chat-reasoning-toggle"]').last()
  await expect(toggle).toBeVisible({ timeout: 10_000 })
  return toggle
}

async function getLastAssistantToolCallBlock(world: CradleWorld, toolName: string) {
  const assistantBubble = await getLastAssistantBubble(world)
  const block = assistantBubble.locator('[data-testid^="chat-tool-call-"]')
    .filter({ hasText: toolName })
    .first()
  await expect(block).toBeVisible({ timeout: 10_000 })
  return block
}

async function clearBrowserClipboard(world: CradleWorld): Promise<void> {
  await world.page.evaluate(() => navigator.clipboard.writeText(''))
}

Given('应用已启动', async function (this: CradleWorld) {
  console.warn('[step] assert app is launched')
  await this.page.waitForLoadState('domcontentloaded')
})

Given('我已配置 Mock LLM Provider', async function (this: CradleWorld) {
  await configureDefaultMockProvider(this)
})

Given('我已配置会慢速流式返回的 Mock LLM Provider', async function (this: CradleWorld) {
  await configureSlowMockProvider(this)
})

Given('我已配置按轮次返回不同回复的 Mock LLM Provider', async function (this: CradleWorld) {
  await configureContextMockProvider(this)
})

Given('我已配置用于 Markdown 导出的 Mock LLM Provider', async function (this: CradleWorld) {
  await configureMarkdownExportMockProvider(this)
})

Given('我已配置会返回 Reasoning 的 Mock LLM Provider', async function (this: CradleWorld) {
  await configureReasoningMockProvider(this)
})

Given('我已配置会返回 Tool Call 的 Mock LLM Provider', async function (this: CradleWorld) {
  await configureToolCallMockProvider(this)
})

Given('我已配置会失败的 Mock LLM Provider', async function (this: CradleWorld) {
  await configureFailingMockProvider(this)
})

When('我点击"新建聊天"导航项', async function (this: CradleWorld) {
  const navItem = this.page.locator('[data-testid="nav-new-chat"]')
  await expect(navItem).toBeVisible({ timeout: 15_000 })
  await navItem.click()
})

Given('我已导航到新建聊天页面', async function (this: CradleWorld) {
  await navigateToNewChat(this)
})

Then('我应该看到新建聊天页面', async function (this: CradleWorld) {
  await expect(this.page.locator('[data-testid="new-chat-page"]')).toBeVisible({ timeout: 10_000 })
})

Then('聊天输入框应可见', async function (this: CradleWorld) {
  await expect(this.page.locator('[data-testid="new-chat-textarea"]')).toBeVisible({ timeout: 10_000 })
})

When('我在新建聊天输入框中输入{string}', async function (this: CradleWorld, text: string) {
  const textarea = this.page.locator('[data-testid="new-chat-textarea"]')
  await expect(textarea).toBeVisible({ timeout: 10_000 })
  await textarea.fill(text)
})

When('我点击发送按钮', async function (this: CradleWorld) {
  const button = this.page.locator('[data-testid="new-chat-send-btn"]')
  await expect(button).toBeEnabled({ timeout: 10_000 })
  await button.click()
})

Then('应该跳转到聊天视图', async function (this: CradleWorld) {
  await getChatView(this)
})

Then('我应该看到用户消息{string}', async function (this: CradleWorld, text: string) {
  const userBubble = this.page.locator('[data-testid="message-bubble-user"]').filter({ hasText: text })
  await expect(userBubble).toBeVisible({ timeout: CHAT_STATUS_TIMEOUT })
})

Then('我应该看到 AI 回复消息', async function (this: CradleWorld) {
  await waitForChatStatus(this, 'idle')
  const assistantBubble = await getLastAssistantBubble(this)
  await expect(assistantBubble).toContainText('Hello from mock LLM!', { timeout: CHAT_STATUS_TIMEOUT })
  await expect(this.page.locator('[data-testid="chat-error-banner"]')).toHaveCount(0)
})

Given('我已在新建聊天页面发送了初始消息', async function (this: CradleWorld) {
  console.warn('[step] create initial chat session from new-chat page')
  await createRememberedSession(this, '初始会话', '初始测试消息')
})

When('我新建一个聊天会话并记住为{string}，首条消息为{string}', async function (this: CradleWorld, alias: string, text: string) {
  await createRememberedSession(this, alias, text)
})

When('我在聊天输入框中输入{string}', async function (this: CradleWorld, text: string) {
  const textarea = this.page.locator('[data-testid="chat-composer-textarea"]')
  await expect(textarea).toBeVisible({ timeout: 10_000 })
  await textarea.fill(text)
})

When('我点击聊天发送按钮', async function (this: CradleWorld) {
  const button = this.page.locator('[data-testid="chat-send-btn"]')
  await expect(button).toBeEnabled({ timeout: 10_000 })
  await button.click()
})

Then('侧栏应显示至少一个会话项', async function (this: CradleWorld) {
  await expect(this.page.locator('[data-testid^="session-item-"]').first()).toBeVisible({ timeout: 10_000 })
})

Then('侧栏应显示会话{string}', async function (this: CradleWorld, alias: string) {
  await waitForSessionSidebarItem(this, recallSessionAlias(this, alias).id)
})

Then('侧栏中不应显示会话{string}', async function (this: CradleWorld, alias: string) {
  await expect(this.page.locator(`[data-testid="session-item-${recallSessionAlias(this, alias).id}"]`)).toHaveCount(0, { timeout: 10_000 })
})

Then('侧栏会话顺序应为{string}在{string}之前', async function (this: CradleWorld, firstAlias: string, secondAlias: string) {
  const firstSessionId = recallSessionAlias(this, firstAlias).id
  const secondSessionId = recallSessionAlias(this, secondAlias).id

  await expect.poll(async () => getVisibleSessionOrder(this), { timeout: 10_000 }).toContain(firstSessionId)
  const order = await getVisibleSessionOrder(this)
  const firstIndex = order.indexOf(firstSessionId)
  const secondIndex = order.indexOf(secondSessionId)

  expect(firstIndex).toBeGreaterThanOrEqual(0)
  expect(secondIndex).toBeGreaterThanOrEqual(0)
  expect(firstIndex).toBeLessThan(secondIndex)
})

Then('最后一条 AI 消息应包含{string}', async function (this: CradleWorld, text: string) {
  const assistantBubble = await getLastAssistantBubble(this)
  await expect(assistantBubble).toContainText(text, { timeout: CHAT_STATUS_TIMEOUT })
})

Then('聊天中不应出现错误提示', async function (this: CradleWorld) {
  await expect(this.page.locator('[data-testid="chat-error-banner"]')).toHaveCount(0)
})

Then('聊天流应处于进行中', async function (this: CradleWorld) {
  await waitForChatStatus(this, 'streaming')
  await expect(this.page.locator('[data-testid="chat-stop-btn"]')).toBeVisible({ timeout: 10_000 })
})

When('我点击停止生成按钮', async function (this: CradleWorld) {
  const button = this.page.locator('[data-testid="chat-stop-btn"]')
  await expect(button).toBeVisible({ timeout: 10_000 })
  await button.click()
})

Then('停止生成按钮应消失', async function (this: CradleWorld) {
  await expect(this.page.locator('[data-testid="chat-stop-btn"]')).toHaveCount(0, { timeout: CHAT_STATUS_TIMEOUT })
})

When('我打开会话{string}的菜单', async function (this: CradleWorld, alias: string) {
  await openSessionMenu(this, recallSessionAlias(this, alias).id)
})

When('我点击会话{string}的置顶菜单项', async function (this: CradleWorld, alias: string) {
  await clickSessionMenuAction(this, recallSessionAlias(this, alias).id, 'toggle-pin')
})

When('我点击会话{string}的取消置顶菜单项', async function (this: CradleWorld, alias: string) {
  await clickSessionMenuAction(this, recallSessionAlias(this, alias).id, 'toggle-pin')
})

When('我点击会话{string}的删除菜单项', async function (this: CradleWorld, alias: string) {
  await clickSessionMenuAction(this, recallSessionAlias(this, alias).id, 'delete')
})

When('我点击会话{string}的重命名菜单项', async function (this: CradleWorld, alias: string) {
  await clickSessionMenuAction(this, recallSessionAlias(this, alias).id, 'rename')
})

When('我将会话{string}重命名为{string}', async function (this: CradleWorld, alias: string, nextTitle: string) {
  const sessionId = recallSessionAlias(this, alias).id
  const input = this.page.locator(`[data-testid="session-rename-input-${sessionId}"]`)

  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(nextTitle)
  await input.press('Enter')
  await expect(input).toHaveCount(0, { timeout: 10_000 })
})

When('我点击会话{string}的复制 Markdown 菜单项', async function (this: CradleWorld, alias: string) {
  await clickSessionMenuAction(this, recallSessionAlias(this, alias).id, 'copy-markdown')
})

When('我清空 Electron 剪贴板', async function (this: CradleWorld) {
  await clearBrowserClipboard(this)
})

Then('我应该看到至少一条 AI 消息', async function (this: CradleWorld) {
  const assistantBubbles = this.page.locator('[data-testid="message-bubble-assistant"]')
  expect(await assistantBubbles.count()).toBeGreaterThanOrEqual(1)
  await expect(assistantBubbles.last()).toBeVisible({ timeout: CHAT_STATUS_TIMEOUT })
})

Then('聊天错误提示应显示{string}', async function (this: CradleWorld, text: string) {
  const errorBanner = this.page.locator('[data-testid="chat-error-banner"]')
  await expect(errorBanner).toBeVisible({ timeout: CHAT_STATUS_TIMEOUT })
  await expect(errorBanner).toContainText(text, { timeout: CHAT_STATUS_TIMEOUT })
})

When('我重新加载当前页面', async function (this: CradleWorld) {
  await this.page.reload()
  await this.page.waitForLoadState('domcontentloaded')
  await getChatView(this)
})

Then('会话{string}应显示为已置顶', async function (this: CradleWorld, alias: string) {
  const sessionId = recallSessionAlias(this, alias).id
  const item = this.page.locator(`[data-testid="session-item-${sessionId}"]`)

  await expect(item).toHaveAttribute('data-session-pinned', 'true', { timeout: 10_000 })
  await expect(this.page.locator(`[data-testid="session-pin-indicator-${sessionId}"]`)).toBeVisible({ timeout: 10_000 })
})

Then('会话{string}不应显示为已置顶', async function (this: CradleWorld, alias: string) {
  const sessionId = recallSessionAlias(this, alias).id
  const item = this.page.locator(`[data-testid="session-item-${sessionId}"]`)

  await expect(item).toHaveAttribute('data-session-pinned', 'false', { timeout: 10_000 })
  await expect(item.locator(`[data-testid="session-pin-indicator-${sessionId}"]`)).toHaveCount(0)
})

Then('侧栏中的会话{string}标题应为{string}', async function (this: CradleWorld, alias: string, expectedTitle: string) {
  const sessionId = recallSessionAlias(this, alias).id
  await expect(this.page.locator(`[data-testid="session-title-${sessionId}"]`)).toHaveText(expectedTitle, { timeout: 10_000 })
})

Then('最后一条 AI 消息应显示 Reasoning 入口', async function (this: CradleWorld) {
  await getLastAssistantReasoningToggle(this)
})

When('我展开最后一条 AI 消息的 Reasoning', async function (this: CradleWorld) {
  const toggle = await getLastAssistantReasoningToggle(this)
  await toggle.click()
})

Then('最后一条 AI 消息的 Reasoning 应包含{string}', async function (this: CradleWorld, text: string) {
  const assistantBubble = await getLastAssistantBubble(this)
  const content = assistantBubble.locator('[data-testid="chat-reasoning-content"]').last()
  await expect(content).toBeVisible({ timeout: 10_000 })
  await expect(content).toContainText(text, { timeout: 10_000 })
})

Then('最后一条 AI 消息应显示名为{string}的 Tool Call', async function (this: CradleWorld, toolName: string) {
  await getLastAssistantToolCallBlock(this, toolName)
})

When('我展开最后一条 AI 消息中名为{string}的 Tool Call', async function (this: CradleWorld, toolName: string) {
  const block = await getLastAssistantToolCallBlock(this, toolName)
  const toggle = block.locator('[data-testid^="chat-tool-call-toggle-"]').first()
  await expect(toggle).toBeVisible({ timeout: 10_000 })
  await toggle.click()
  await expect(block.locator('[data-testid^="chat-tool-call-content-"]').first()).toBeVisible({ timeout: 10_000 })
})

Then('最后一条 AI 消息中名为{string}的 Tool Call 输入应包含{string}', async function (this: CradleWorld, toolName: string, text: string) {
  const block = await getLastAssistantToolCallBlock(this, toolName)
  await expect(block.locator('[data-testid^="chat-tool-call-input-"]').first()).toContainText(text, { timeout: 10_000 })
})

Then('最后一条 AI 消息中名为{string}的 Tool Call 输出应包含{string}', async function (this: CradleWorld, toolName: string, text: string) {
  const block = await getLastAssistantToolCallBlock(this, toolName)
  await expect(block.locator('[data-testid^="chat-tool-call-output-"]').first()).toContainText(text, { timeout: 10_000 })
})

Then('Electron 剪贴板中应包含以下 Markdown 片段:', async function (this: CradleWorld, table: DataTable) {
  const fragments = table.raw().flat().map(fragment => fragment.trim()).filter(Boolean)

  await expect.poll(async () => readBrowserClipboardText(this), { timeout: 10_000 }).not.toBe('')
  const clipboardText = await readBrowserClipboardText(this)

  for (const fragment of fragments) {
    expect(clipboardText).toContain(fragment)
  }
})
