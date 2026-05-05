// Input: Cucumber step bindings, Playwright assertions, and CradleWorld mock-provider helpers
// Output: Chat-focused E2E step definitions with scenario-isolated mock setup and state-driven assertions
// Position: E2E step layer covering chat.feature happy path, cancellation, provider errors, and reconnect flows

import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world'

const DEFAULT_RESPONSE = 'Hello from mock LLM! I am an AI assistant.'
const SLOW_RESPONSE = Array.from({ length: 30 }).fill('Hello from mock LLM!').join(' ')
const CHAT_VIEW_TIMEOUT = 20_000
const CHAT_STATUS_TIMEOUT = 30_000

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

async function queryPersistedSessionRow<T>(
  world: CradleWorld,
  sql: string,
  sessionId: string,
): Promise<T | null> {
  return world.mainProcess<T | null, { sessionId: string, sql: string }>(
    async (electron, { sessionId, sql }) => {
      const getBuiltinModule = process.getBuiltinModule?.bind(process)

      if (!getBuiltinModule) {
        throw new Error('process.getBuiltinModule unavailable in Electron evaluate context')
      }

      const path = getBuiltinModule('node:path')
      const moduleApi = getBuiltinModule('node:module')
      const requireFromApp = moduleApi.createRequire(path.join(electron.app.getAppPath(), 'package.json'))
      const Database = requireFromApp('better-sqlite3')

      if (!Database) {
        throw new Error('better-sqlite3 default export unavailable in Electron main process')
      }

      const dbPath = path.join(electron.app.getPath('userData'), 'cradle.db')
      const db = new Database(dbPath, { readonly: true })

      try {
        return (db.prepare(sql).get(sessionId) as T | undefined) ?? null
      }
      finally {
        db.close()
      }
    },
    { sessionId, sql },
  )
}

async function getChatView(world: CradleWorld) {
  const chatView = world.page.locator('[data-testid="chat-view"]')
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

async function configureFailingMockProvider(world: CradleWorld): Promise<void> {
  console.warn('[step] configure failing mock LLM provider')
  await world.configureMockLlmProvider({
    failureMode: 'http-error',
    errorStatusCode: 503,
    errorMessage: 'Mock LLM forced failure',
  })
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
  await navigateToNewChat(this)

  const textarea = this.page.locator('[data-testid="new-chat-textarea"]')
  await expect(textarea).toBeVisible({ timeout: 10_000 })
  await textarea.fill('初始测试消息')

  const button = this.page.locator('[data-testid="new-chat-send-btn"]')
  await expect(button).toBeEnabled({ timeout: 10_000 })
  await button.click()

  await waitForChatStatus(this, 'idle')
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

Then('聊天流应处于进行中', async function (this: CradleWorld) {
  await waitForChatStatus(this, 'streaming')
  await expect(this.page.locator('[data-testid="chat-stop-btn"]')).toBeVisible({ timeout: 10_000 })
})

When('我点击停止生成按钮', async function (this: CradleWorld) {
  const button = this.page.locator('[data-testid="chat-stop-btn"]')
  await expect(button).toBeVisible({ timeout: 10_000 })
  await button.click()
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
  const binding = await queryPersistedSessionRow<PersistedBackendBinding>(
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
    chatSessionId,
  )

  expect(binding).not.toBeNull()
  expect(binding).toEqual(expect.objectContaining({ chatSessionId }))
})

Then('当前聊天会话应持久化一条状态为{string}的 backend run', async function (this: CradleWorld, status: string) {
  const chatSessionId = await getCurrentChatSessionId(this)
  const run = await queryPersistedSessionRow<PersistedBackendRun>(
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
    chatSessionId,
  )

  expect(run).not.toBeNull()
  expect(run).toEqual(expect.objectContaining({ chatSessionId, status }))
})
