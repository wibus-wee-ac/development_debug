import { After, Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import { MockLlmServer } from '../support/mock-llm-server'
import type { CradleWorld } from '../support/world'

const AGENT_CREATE_PAGE = '[data-testid="agent-create"]'
const AGENT_NAME_INPUT = '[data-testid="agent-detail-name"]'
const BG_FOREGROUND_RE = /bg-foreground/

async function selectOption(world: CradleWorld, triggerSelector: string, value: string) {
  const trigger = world.page.locator(triggerSelector)
  await expect(trigger).toBeVisible({ timeout: 10_000 })
  await trigger.click()

  const option = world.page.getByRole('option', { name: value })
  await expect(option).toBeVisible({ timeout: 10_000 })
  await option.click()
}

function getProviderRows(world: CradleWorld, name: string) {
  return world.page.locator('[data-testid^="agent-profile-row-"]').filter({ hasText: name })
}

async function ensureSettingsOpen(world: CradleWorld): Promise<void> {
  const agentsNav = world.page.locator('[data-testid="settings-nav-agents"]')
  if (await agentsNav.isVisible().catch(() => false)) {
    return
  }

  const settingsBtn = world.page.locator('[data-testid="settings-btn"]')
  await expect(settingsBtn).toBeVisible({ timeout: 15_000 })
  await settingsBtn.click()
}

async function openSettingsSection(world: CradleWorld, navTestId: string, pageSelector: string): Promise<void> {
  await ensureSettingsOpen(world)

  const navItem = world.page.locator(`[data-testid="${navTestId}"]`)
  await expect(navItem).toBeVisible({ timeout: 5_000 })
  await navItem.click()
  await expect(world.page.locator(pageSelector)).toBeVisible({ timeout: 10_000 })
}

/** Keep mock servers alive per test — keyed by modelId, storing server + baseUrl. */
const mockServers = new Map<string, { server: MockLlmServer, baseUrl: string }>()

After(async () => {
  for (const { server } of mockServers.values()) {
    await server.stop().catch(() => {})
  }
  mockServers.clear()
})

async function ensureAgentMockProviderBaseUrl(world: CradleWorld, modelId: string): Promise<string> {
  const existing = mockServers.get(modelId)
  if (existing) {
    return existing.baseUrl
  }

  const server = new MockLlmServer({
    models: [
      { id: modelId, owned_by: 'agent-identity-e2e' },
    ],
  })
  const baseUrl = await server.start()
  mockServers.set(modelId, { server, baseUrl })

  // Also keep the world's last mock server reference for cleanup
  world.mockLlmServer = server
  world.mockLlmBaseUrl = baseUrl
  return baseUrl
}

async function createProviderViaUi(world: CradleWorld, providerName: string, modelId: string): Promise<void> {
  await openSettingsSection(world, 'settings-nav-providers', '[data-testid="agent-runtime-settings"]')

  const existingRow = getProviderRows(world, providerName).first()
  if (await existingRow.isVisible().catch(() => false)) {
    return
  }

  const addProviderButton = world.page.locator('[data-testid="add-provider-btn"]')
  await expect(addProviderButton).toBeVisible({ timeout: 10_000 })
  await addProviderButton.click()

  const presetCard = world.page.locator('[data-testid="provider-preset-custom"]')
  await expect(presetCard).toBeVisible({ timeout: 10_000 })
  await presetCard.click()

  const nameInput = world.page.locator('[data-testid="provider-name"]')
  await expect(nameInput).toBeVisible({ timeout: 10_000 })
  await nameInput.clear()
  await nameInput.fill(providerName)

  const baseUrlInput = world.page.locator('[data-testid="provider-baseurl"]')
  await expect(baseUrlInput).toBeVisible({ timeout: 10_000 })
  await baseUrlInput.fill(await ensureAgentMockProviderBaseUrl(world, modelId))

  const modelInput = world.page.locator('[data-testid="provider-model"]')
  await expect(modelInput).toBeVisible({ timeout: 10_000 })
  await modelInput.fill(modelId)

  const apiKeyInput = world.page.locator('[data-testid="provider-apikey"]')
  await expect(apiKeyInput).toBeVisible({ timeout: 10_000 })
  await apiKeyInput.fill('agent-identity-test-key')

  const submitButton = world.page.locator('[data-testid="provider-submit"]')
  await expect(submitButton).toBeVisible({ timeout: 10_000 })
  await submitButton.click()

  await expect(getProviderRows(world, providerName).first()).toBeVisible({ timeout: 15_000 })
}

async function openAgentList(world: CradleWorld): Promise<void> {
  await openSettingsSection(world, 'settings-nav-agents', '[data-testid="agent-list"]')
}

async function createAgentViaUi(
  world: CradleWorld,
  agentName: string,
  providerName: string,
  modelId: string,
  thinkingEffort: 'low' | 'medium' | 'high' | 'auto',
): Promise<void> {
  await createProviderViaUi(world, providerName, modelId)
  await openAgentList(world)

  const existingRow = getAgentRows(world, agentName).first()
  if (await existingRow.isVisible().catch(() => false)) {
    return
  }

  const newAgentButton = world.page.locator('[data-testid="new-agent-btn"]')
  await expect(newAgentButton).toBeVisible({ timeout: 10_000 })
  await newAgentButton.click()

  const nameInput = world.page.locator(AGENT_NAME_INPUT)
  await expect(nameInput).toBeVisible({ timeout: 10_000 })
  await nameInput.fill(agentName)

  await selectOption(world, '[data-testid="agent-provider-select"]', providerName)
  await selectOption(world, '[data-testid="agent-model-select"]', modelId)

  const thinkingButton = world.page.locator(`[data-testid="agent-thinking-${thinkingEffort}"]`)
  await expect(thinkingButton).toBeVisible({ timeout: 10_000 })
  await thinkingButton.click()

  const saveButton = world.page.locator('[data-testid="agent-detail-save"]')
  await expect(saveButton).toBeEnabled({ timeout: 10_000 })
  await saveButton.click()

  await expect(world.page.locator('[data-testid="agent-detail-delete-trigger"]')).toBeVisible({ timeout: 10_000 })

  const backButton = world.page.locator('[data-testid="agent-detail-back"]')
  await expect(backButton).toBeVisible({ timeout: 10_000 })
  await backButton.click()

  await expect(world.page.locator('[data-testid="agent-list"]')).toBeVisible({ timeout: 10_000 })
  await expect(getAgentRows(world, agentName).first()).toBeVisible({ timeout: 10_000 })
}

function getAgentRows(world: CradleWorld, name: string) {
  return world.page.locator('[data-testid^="agent-row-"]').filter({ hasText: name })
}

// ── Navigation ────────────────────────────────────────────────────────────────

When('我点击"Agents"导航项', async function (this: CradleWorld) {
  console.warn('[step] click Agents nav item')
  const navItem = this.page.locator('[data-testid="settings-nav-agents"]')
  await expect(navItem).toBeVisible({ timeout: 5000 })
  await navItem.click()
})

Given('我已进入 Agent 列表页面', async function (this: CradleWorld) {
  console.warn('[step] navigate to Agent list settings')
  await openAgentList(this)
})

Then('我应该看到 Agent 列表页面', async function (this: CradleWorld) {
  console.warn('[step] assert Agent list visible')
  const agentList = this.page.locator('[data-testid="agent-list"]')
  await expect(agentList).toBeVisible({ timeout: 10000 })
})

// ── Empty state ───────────────────────────────────────────────────────────────

Then('我应该看到 Agent 空状态提示', async function (this: CradleWorld) {
  console.warn('[step] assert Agent empty state visible')
  const emptyState = this.page.locator('[data-testid="agent-empty-state"]')
  await expect(emptyState).toBeVisible({ timeout: 5000 })
})

// ── Create form ───────────────────────────────────────────────────────────────

When('我点击"New Agent"按钮', async function (this: CradleWorld) {
  console.warn('[step] click New Agent button')
  const btn = this.page.locator('[data-testid="new-agent-btn"]')
  await expect(btn).toBeVisible({ timeout: 5000 })
  await btn.click()
})

Given('我已打开 Agent 创建页面', async function (this: CradleWorld) {
  console.warn('[step] open Agent create page')
  const btn = this.page.locator('[data-testid="new-agent-btn"]')
  await expect(btn).toBeVisible({ timeout: 5000 })
  await btn.click()

  await expect(this.page.locator(AGENT_CREATE_PAGE)).toBeVisible({ timeout: 5000 })
  const nameInput = this.page.locator(AGENT_NAME_INPUT)
  await expect(nameInput).toBeVisible({ timeout: 5000 })
})

Then('我应该看到 Agent 创建页面', async function (this: CradleWorld) {
  console.warn('[step] assert Agent create page visible')
  await expect(this.page.locator(AGENT_CREATE_PAGE)).toBeVisible({ timeout: 5000 })
  const nameInput = this.page.locator(AGENT_NAME_INPUT)
  await expect(nameInput).toBeVisible({ timeout: 5000 })
})

// ── Avatar ────────────────────────────────────────────────────────────────────

Then('我应该看到 DiceBear 头像预览', async function (this: CradleWorld) {
  console.warn('[step] assert DiceBear avatar preview visible')
  const avatar = this.page.locator(`${AGENT_CREATE_PAGE} img`).first()
  await expect(avatar).toBeVisible({ timeout: 5000 })
  const src = await avatar.getAttribute('src')
  expect(src).toContain('dicebear.com')
})

Given('我已准备名为{string}模型为{string}的 Agent Provider', async function (
  this: CradleWorld,
  providerName: string,
  modelId: string,
) {
  console.warn(`[step] prepare provider ${providerName} (${modelId})`)
  await createProviderViaUi(this, providerName, modelId)
})

Given('我已有一个名称为{string}、Provider 为{string}、Model 为{string}、Thinking Effort 为{string}的 Agent', async function (
  this: CradleWorld,
  agentName: string,
  providerName: string,
  modelId: string,
  thinkingEffort: 'low' | 'medium' | 'high' | 'auto',
) {
  console.warn(`[step] prepare agent ${agentName}`)
  await createAgentViaUi(this, agentName, providerName, modelId, thinkingEffort)
})

When('我填写 Agent 名称为{string}', async function (this: CradleWorld, name: string) {
  console.warn(`[step] fill agent name: ${name}`)
  const input = this.page.locator(AGENT_NAME_INPUT)
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.fill(name)
})

When('我选择 Agent Provider 为{string}', async function (this: CradleWorld, providerName: string) {
  console.warn(`[step] select agent provider: ${providerName}`)
  await selectOption(this, '[data-testid="agent-provider-select"]', providerName)
})

When('我选择 Agent Model 为{string}', async function (this: CradleWorld, modelId: string) {
  console.warn(`[step] select agent model: ${modelId}`)
  await selectOption(this, '[data-testid="agent-model-select"]', modelId)
})

When('我选择 Agent Thinking Effort 为{string}', async function (this: CradleWorld, thinkingEffort: 'low' | 'medium' | 'high' | 'auto') {
  console.warn(`[step] select agent thinking effort: ${thinkingEffort}`)
  const button = this.page.locator(`[data-testid="agent-thinking-${thinkingEffort}"]`)
  await expect(button).toBeVisible({ timeout: 5000 })
  await button.click()
})

When('我点击创建 Agent 保存按钮', async function (this: CradleWorld) {
  console.warn('[step] click create agent save button')
  const button = this.page.locator('[data-testid="agent-detail-save"]')
  await expect(button).toBeEnabled({ timeout: 5000 })
  await button.click()
})

Then('当前 Agent Model 应显示{string}', async function (this: CradleWorld, modelId: string) {
  console.warn(`[step] assert current agent model visible: ${modelId}`)
  const modelTrigger = this.page.locator('[data-testid="agent-model-select"]')
  await expect(modelTrigger).toBeVisible({ timeout: 10_000 })
  await expect(modelTrigger).toContainText(modelId, { timeout: 10_000 })
})

Then('Agent 详情页应显示名称为{string}', async function (this: CradleWorld, name: string) {
  console.warn(`[step] assert agent detail visible for ${name}`)
  await expect(this.page.locator(AGENT_NAME_INPUT)).toHaveValue(name, { timeout: 10_000 })
  await expect(this.page.locator('[data-testid="agent-detail-delete-trigger"]')).toBeVisible({ timeout: 10_000 })
})

Then('当前 Agent Thinking Effort 应显示{string}', async function (this: CradleWorld, thinkingEffort: 'low' | 'medium' | 'high' | 'auto') {
  console.warn(`[step] assert current agent thinking effort visible: ${thinkingEffort}`)
  const button = this.page.locator(`[data-testid="agent-thinking-${thinkingEffort}"]`)
  await expect(button).toBeVisible({ timeout: 10_000 })
  await expect(button).toHaveClass(BG_FOREGROUND_RE, { timeout: 10_000 })
})

Then('Agent 详情应显示已保存状态', async function (this: CradleWorld) {
  console.warn('[step] assert agent detail save indicator visible')
  await expect(this.page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 })
})

When('我返回 Agent 列表', async function (this: CradleWorld) {
  console.warn('[step] navigate back to agent list')
  const backButton = this.page.locator('[data-testid="agent-detail-back"]')
  await expect(backButton).toBeVisible({ timeout: 5000 })
  await backButton.click()
  await expect(this.page.locator('[data-testid="agent-list"]')).toBeVisible({ timeout: 10_000 })
})

Then('Agent 列表中应显示名称为{string}、Provider 为{string}、Model 为{string}的条目', async function (
  this: CradleWorld,
  name: string,
  providerName: string,
  modelId: string,
) {
  console.warn(`[step] assert agent row visible: ${name}`)
  const row = getAgentRows(this, name).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await expect(row).toContainText(name)
  await expect(row).toContainText(providerName)
  await expect(row).toContainText(modelId)
  await expect(row.locator(`img[alt="${name}"]`)).toBeVisible({ timeout: 5000 })
})

When('我打开名称为{string}的 Agent', async function (this: CradleWorld, name: string) {
  console.warn(`[step] open agent row: ${name}`)
  const row = getAgentRows(this, name).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()
  await expect(this.page.locator(AGENT_NAME_INPUT)).toHaveValue(name, { timeout: 10_000 })
})

When('我删除当前 Agent', async function (this: CradleWorld) {
  console.warn('[step] delete current agent')
  const trigger = this.page.locator('[data-testid="agent-detail-delete-trigger"]')
  await expect(trigger).toBeVisible({ timeout: 5000 })
  await trigger.click()

  const confirm = this.page.locator('[data-testid="agent-detail-delete-confirm"]')
  await expect(confirm).toBeVisible({ timeout: 5000 })
  await confirm.click()
})

Then('Agent 列表中不应显示名称为{string}的条目', async function (this: CradleWorld, name: string) {
  console.warn(`[step] assert agent row absent: ${name}`)
  await expect(this.page.locator('[data-testid="agent-list"]')).toBeVisible({ timeout: 10_000 })
  const row = getAgentRows(this, name)
  await expect(row).toHaveCount(0, { timeout: 10_000 })
})
