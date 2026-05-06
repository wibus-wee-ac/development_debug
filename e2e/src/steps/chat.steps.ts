// Input: Cucumber step bindings, Playwright assertions, scenario-scoped mock LLM logs, and shared DB helpers
// Output: Chat-focused E2E step definitions covering request-body context propagation, session menu actions, persistence, and stream lifecycle
// Position: E2E step layer covering chat.feature happy path, multi-turn context, cancellation, provider errors, reconnect, and session management flows

import type { DataTable } from '@cucumber/cucumber'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import { queryDatabaseRow, queryDatabaseRows } from '../support/database'
import type { MockLlmRequestLogEntry, MockToolCall } from '../support/mock-llm-server'
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
const TAB_PILL = '[data-testid^="tab-pill-"]'

type PersistedChatMessage = {
  id: string
  role: 'user' | 'assistant'
  status: string
  content: string
  errorText?: string | null
}

type PersistedBackendBinding = {
  chatSessionId: string
  backendSessionId: string | null
  requestedModelId: string | null
}

type PersistedBackendRun = {
  chatSessionId: string
  status: string
  stopReason: string | null
}

type PersistedTimelineEvent = {
  eventType: string
  sequenceNumber: number
}

type SessionAlias = {
  id: string
  firstUserText: string
}

type PersistedPinnedRow = {
  pinned: number
}

type PersistedTitleRow = {
  title: string
}

type CountRow = {
  count: number
}

type ParsedRequestMessage = {
  role: string
  content: string
}

type PersistedEventTypeRow = {
  eventType: string
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
  const activeTab = world.page.locator(`${TAB_PILL}[data-tab-active="true"]`).first()
  await expect(activeTab).toBeVisible({ timeout: 15_000 })

  const activeTabTestId = await activeTab.getAttribute('data-testid')
  if (!activeTabTestId) {
    throw new Error('Expected active tab pill to expose a data-testid')
  }

  const activeTabId = activeTabTestId.replace('tab-pill-', '')
  const chatView = world.page.locator(`[data-testid="tab-content-${activeTabId}"] [data-testid="chat-view"]`).first()
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

async function getPersistedMessages(world: CradleWorld): Promise<PersistedChatMessage[]> {
  const chatSessionId = await getCurrentChatSessionId(world)
  return world.page.evaluate(async (sessionId) => {
    // eslint-disable-next-line ts/no-explicit-any
    const ipcRenderer = (window as any).electron?.ipcRenderer
    if (!ipcRenderer?.invoke) {
      throw new Error('electron.ipcRenderer not available')
    }

    return ipcRenderer.invoke('chat.getMessages', sessionId) as Promise<PersistedChatMessage[]>
  }, chatSessionId)
}

async function getLastAssistantPersistedMessage(world: CradleWorld): Promise<PersistedChatMessage> {
  const messages = await getPersistedMessages(world)
  const assistantMessage = [...messages].reverse().find(message => message.role === 'assistant')
  if (!assistantMessage) {
    throw new Error('Expected at least one persisted assistant message')
  }
  return assistantMessage
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
      .map((element) => element.getAttribute('data-testid')?.replace('session-item-', ''))
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
  })
}

async function readElectronClipboardText(world: CradleWorld): Promise<string> {
  return world.mainProcess<string>(({ clipboard }) => clipboard.readText())
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

async function getTimelineEventTypes(world: CradleWorld): Promise<string[]> {
  const chatSessionId = await getCurrentChatSessionId(world)
  const rows = await queryDatabaseRows<PersistedEventTypeRow>(
    world,
    `
      SELECT
        event_type AS eventType
      FROM backend_timeline_events
      WHERE chat_session_id = ?
      ORDER BY sequence_number ASC
    `,
    [chatSessionId],
  )

  return rows.map(row => row.eventType)
}

async function clearElectronClipboard(world: CradleWorld): Promise<void> {
  await world.mainProcess<void>(({ clipboard }) => {
    clipboard.clear()
  })
}

function getChatCompletionRequests(world: CradleWorld): MockLlmRequestLogEntry[] {
  if (!world.mockLlmServer) {
    throw new Error('Mock LLM server is not configured for this scenario')
  }

  return world.mockLlmServer.getRequestLog().filter(entry => (
    entry.method === 'POST'
    && entry.path.endsWith('/chat/completions')
  ))
}

function normalizeOpenAiMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part
        }

        if (
          typeof part === 'object'
          && part !== null
          && 'text' in part
          && typeof (part as { text?: unknown }).text === 'string'
        ) {
          return (part as { text: string }).text
        }

        return ''
      })
      .join('')
  }

  return ''
}

function parseChatCompletionRequest(entry: MockLlmRequestLogEntry): ParsedRequestMessage[] {
  const parsed = JSON.parse(entry.body) as {
    messages?: Array<{ role?: string, content?: unknown }>
  }

  return (parsed.messages ?? []).map(message => ({
    role: message.role ?? 'unknown',
    content: normalizeOpenAiMessageContent(message.content),
  }))
}

async function queryCount(world: CradleWorld, sql: string, params: Array<string | number | null>): Promise<number> {
  const row = await queryDatabaseRow<CountRow>(world, sql, params)
  return row?.count ?? 0
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

Then('聊天状态最终应为{string}', async function (this: CradleWorld, status: string) {
  await waitForChatStatus(this, status)
})

Then('最后一条 AI 消息应包含{string}', async function (this: CradleWorld, text: string) {
  const assistantBubble = await getLastAssistantBubble(this)
  await expect(assistantBubble).toContainText(text, { timeout: CHAT_STATUS_TIMEOUT })
})

Then('最后一条 AI 消息持久化状态应为{string}', async function (this: CradleWorld, status: string) {
  if (status === 'failed') {
    await waitForChatStatus(this, 'error')
  }
  else {
    await waitForChatStatus(this, 'idle')
  }

  const assistantMessage = await getLastAssistantPersistedMessage(this)
  expect(assistantMessage.status).toBe(status)
})

Then('聊天中不应出现错误提示', async function (this: CradleWorld) {
  await expect(this.page.locator('[data-testid="chat-error-banner"]')).toHaveCount(0)
})

Then('第 {int} 次 Mock LLM 对话请求的 messages 应按顺序包含以下内容:', async function (this: CradleWorld, requestIndex: number, table: DataTable) {
  const requests = getChatCompletionRequests(this)
  const entry = requests[requestIndex - 1]

  if (!entry) {
    throw new Error(`Expected Mock LLM request #${requestIndex}, but only found ${requests.length}`)
  }

  const actualMessages = parseChatCompletionRequest(entry)
  const expectedMessages = table.hashes().map(row => ({
    role: row.role,
    content: row.content,
  }))

  let cursor = 0
  for (const expectedMessage of expectedMessages) {
    const relativeIndex = actualMessages
      .slice(cursor)
      .findIndex(message => message.role === expectedMessage.role && message.content === expectedMessage.content)

    expect(
      relativeIndex,
      `Expected request #${requestIndex} messages to include ${JSON.stringify(expectedMessage)} in order. Actual messages: ${JSON.stringify(actualMessages, null, 2)}`,
    ).toBeGreaterThanOrEqual(0)

    cursor += relativeIndex + 1
  }
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
  await clearElectronClipboard(this)
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

Then('我记录当前聊天会话标识', async function (this: CradleWorld) {
  this.remember('currentChatSessionId', await getCurrentChatSessionId(this))
})

When('我重新加载当前页面', async function (this: CradleWorld) {
  await this.page.reload()
  await this.page.waitForLoadState('domcontentloaded')
  await getChatView(this)
})

Then('当前聊天会话标识应保持不变', async function (this: CradleWorld) {
  const previousSessionId = this.recall<string>('currentChatSessionId')
  const chatView = await getChatView(this)
  await expect(chatView).toHaveAttribute('data-chat-session-id', previousSessionId, { timeout: CHAT_STATUS_TIMEOUT })
})

Then('当前聊天会话应持久化一条 backend binding', async function (this: CradleWorld) {
  const chatSessionId = await getCurrentChatSessionId(this)
  const binding = await queryDatabaseRow<PersistedBackendBinding>(
    this,
    `
      SELECT
        chat_session_id AS chatSessionId,
        backend_session_id AS backendSessionId,
        requested_model_id AS requestedModelId
      FROM backend_session_bindings
      WHERE chat_session_id = ?
      LIMIT 1
    `,
    [chatSessionId],
  )

  expect(binding).not.toBeNull()
  expect(binding).toEqual(expect.objectContaining({ chatSessionId }))
})

Then('当前聊天会话应持久化一条状态为{string}的 backend run', async function (this: CradleWorld, status: string) {
  const chatSessionId = await getCurrentChatSessionId(this)
  const run = await queryDatabaseRow<PersistedBackendRun>(
    this,
    `
      SELECT
        chat_session_id AS chatSessionId,
        status,
        stop_reason AS stopReason
      FROM backend_runs
      WHERE chat_session_id = ?
      ORDER BY started_at DESC
      LIMIT 1
    `,
    [chatSessionId],
  )

  expect(run).not.toBeNull()
  expect(run).toEqual(expect.objectContaining({ chatSessionId, status }))
})

Then('当前聊天会话应持久化 backend timeline 事件序列', async function (this: CradleWorld) {
  const chatSessionId = await getCurrentChatSessionId(this)
  const timelineEvents = await queryDatabaseRows<PersistedTimelineEvent>(
    this,
    `
      SELECT
        event_type AS eventType,
        sequence_number AS sequenceNumber
      FROM backend_timeline_events
      WHERE chat_session_id = ?
      ORDER BY sequence_number ASC
    `,
    [chatSessionId],
  )

  expect(timelineEvents.length).toBeGreaterThanOrEqual(4)
  expect(timelineEvents.map(event => event.eventType)).toEqual(expect.arrayContaining([
    'run.started',
    'assistant.message.started',
    'assistant.text.delta',
    'run.completed',
  ]))
  expect(timelineEvents.map(event => event.sequenceNumber)).toEqual(
    timelineEvents.map((_, index) => index),
  )
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

Then('会话{string}的数据库置顶状态应为{string}', async function (this: CradleWorld, alias: string, expectedPinned: string) {
  const sessionId = recallSessionAlias(this, alias).id
  const row = await queryDatabaseRow<PersistedPinnedRow>(
    this,
    `
      SELECT pinned
      FROM sessions
      WHERE id = ?
    `,
    [sessionId],
  )

  expect(row).not.toBeNull()
  expect(row?.pinned).toBe(expectedPinned === 'true' ? 1 : 0)
})

Then('侧栏中的会话{string}标题应为{string}', async function (this: CradleWorld, alias: string, expectedTitle: string) {
  const sessionId = recallSessionAlias(this, alias).id
  await expect(this.page.locator(`[data-testid="session-title-${sessionId}"]`)).toHaveText(expectedTitle, { timeout: 10_000 })
})

Then('会话{string}的数据库标题应为{string}', async function (this: CradleWorld, alias: string, expectedTitle: string) {
  const sessionId = recallSessionAlias(this, alias).id
  const row = await queryDatabaseRow<PersistedTitleRow>(
    this,
    `
      SELECT title
      FROM sessions
      WHERE id = ?
    `,
    [sessionId],
  )

  expect(row).not.toBeNull()
  expect(row?.title).toBe(expectedTitle)
})

Then('会话{string}应已从数据库完全删除', async function (this: CradleWorld, alias: string) {
  const sessionId = recallSessionAlias(this, alias).id

  expect(await queryCount(this, 'SELECT count(*) AS count FROM sessions WHERE id = ?', [sessionId])).toBe(0)
  expect(await queryCount(this, 'SELECT count(*) AS count FROM messages WHERE session_id = ?', [sessionId])).toBe(0)
  expect(await queryCount(this, 'SELECT count(*) AS count FROM backend_session_bindings WHERE chat_session_id = ?', [sessionId])).toBe(0)
  expect(await queryCount(this, 'SELECT count(*) AS count FROM backend_runs WHERE chat_session_id = ?', [sessionId])).toBe(0)
  expect(await queryCount(this, 'SELECT count(*) AS count FROM backend_timeline_events WHERE chat_session_id = ?', [sessionId])).toBe(0)
})

Then('被删除的会话{string}不应继续作为当前聊天视图显示', async function (this: CradleWorld, alias: string) {
  const deletedSessionId = recallSessionAlias(this, alias).id
  const activeTab = this.page.locator(`${TAB_PILL}[data-tab-active="true"]`).first()

  await expect(activeTab).toBeVisible({ timeout: 10_000 })

  const activeTabTestId = await activeTab.getAttribute('data-testid')
  if (!activeTabTestId) {
    throw new Error('Expected active tab pill to expose a data-testid while verifying deleted session state')
  }

  const activeTabId = activeTabTestId.replace('tab-pill-', '')
  const visibleChatView = this.page.locator(`[data-testid="tab-content-${activeTabId}"] [data-testid="chat-view"]`).first()

  if (await visibleChatView.count() === 0) {
    return
  }

  await expect(visibleChatView).not.toHaveAttribute('data-chat-session-id', deletedSessionId)
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

Then('当前聊天会话应持久化 reasoning 事件序列', async function (this: CradleWorld) {
  const eventTypes = await getTimelineEventTypes(this)
  expect(eventTypes).toEqual(expect.arrayContaining([
    'reasoning.started',
    'reasoning.delta',
    'reasoning.completed',
  ]))
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

Then('当前聊天会话应持久化 tool call 事件序列', async function (this: CradleWorld) {
  const eventTypes = await getTimelineEventTypes(this)
  expect(eventTypes).toEqual(expect.arrayContaining([
    'tool_call.started',
    'tool_call.completed',
  ]))
})

Then('Electron 剪贴板中应包含以下 Markdown 片段:', async function (this: CradleWorld, table: DataTable) {
  const fragments = table.raw().flat().map(fragment => fragment.trim()).filter(Boolean)

  await expect.poll(async () => readElectronClipboardText(this), { timeout: 10_000 }).not.toBe('')
  const clipboardText = await readElectronClipboardText(this)

  for (const fragment of fragments) {
    expect(clipboardText).toContain(fragment)
  }
})
