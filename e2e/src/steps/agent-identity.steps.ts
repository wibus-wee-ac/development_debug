import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import { queryDatabaseRow } from '../support/database'
import type { CradleWorld } from '../support/world'

const AGENT_CREATE_PAGE = '[data-testid="agent-create"]'
const AGENT_NAME_INPUT = '[data-testid="agent-detail-name"]'
const NON_SLUG_CHAR_RE = /[^a-z0-9]+/g
const EDGE_DASH_RE = /^-+|-+$/g

function slugifyName(name: string): string {
  return name.trim().toLowerCase().replace(NON_SLUG_CHAR_RE, '-').replace(EDGE_DASH_RE, '') || 'item'
}

async function selectOption(world: CradleWorld, triggerSelector: string, value: string) {
  const trigger = world.page.locator(triggerSelector)
  await expect(trigger).toBeVisible({ timeout: 10_000 })
  await trigger.click()

  const option = world.page.getByRole('option', { name: value })
  await expect(option).toBeVisible({ timeout: 10_000 })
  await option.click()
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
  const settingsBtn = this.page.locator('[data-testid="settings-btn"]')
  await expect(settingsBtn).toBeVisible({ timeout: 15000 })
  await settingsBtn.click()

  const navItem = this.page.locator('[data-testid="settings-nav-agents"]')
  await expect(navItem).toBeVisible({ timeout: 5000 })
  await navItem.click()

  const agentList = this.page.locator('[data-testid="agent-list"]')
  await expect(agentList).toBeVisible({ timeout: 5000 })
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
  const providerId = `e2e-provider-${slugifyName(providerName)}`

  await this.page.evaluate(async ({ providerId, providerName, modelId }) => {
    // eslint-disable-next-line ts/no-explicit-any
    const ipcRenderer = (window as any).electron?.ipcRenderer
    if (!ipcRenderer?.invoke) {
      throw new Error('electron.ipcRenderer not available')
    }

    await ipcRenderer.invoke('agentRuntime.upsertProfile', {
      id: providerId,
      name: providerName,
      providerKind: 'openai-compatible',
      enabled: true,
      configJson: JSON.stringify({
        baseUrl: 'https://example.invalid/v1',
        model: modelId,
      }),
      credentialRef: null,
    })
  }, { providerId, providerName, modelId })

  this.remember(`provider:${providerName}`, providerId)
})

Given('我已有一个名称为{string}、Provider 为{string}、Model 为{string}、Thinking Effort 为{string}的 Agent', async function (
  this: CradleWorld,
  agentName: string,
  providerName: string,
  modelId: string,
  thinkingEffort: 'low' | 'medium' | 'high' | 'auto',
) {
  console.warn(`[step] prepare agent ${agentName}`)
  const providerId = this.recall<string>(`provider:${providerName}`)

  const created = await this.page.evaluate(async ({ agentName, providerId, modelId, thinkingEffort }) => {
    // eslint-disable-next-line ts/no-explicit-any
    const ipcRenderer = (window as any).electron?.ipcRenderer
    if (!ipcRenderer?.invoke) {
      throw new Error('electron.ipcRenderer not available')
    }

    return ipcRenderer.invoke('agent.create', {
      name: agentName,
      description: null,
      avatarStyle: 'bottts-neutral',
      avatarSeed: `seed-${agentName}`,
      providerId,
      modelId,
      thinkingEffort,
      configJson: '{}',
    }) as Promise<{ id: string }>
  }, { agentName, providerId, modelId, thinkingEffort })

  this.remember(`agent:${agentName}`, created.id)
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

Then('数据库中应持久化名称为{string}、Provider 为{string}、Model 为{string}、Thinking Effort 为{string}的 Agent', async function (
  this: CradleWorld,
  name: string,
  providerName: string,
  modelId: string,
  thinkingEffort: 'low' | 'medium' | 'high' | 'auto',
) {
  console.warn(`[step] assert agent persisted: ${name}`)

  await expect.poll(async () => {
    return queryDatabaseRow<{
      id: string
      name: string
      providerName: string
      modelId: string | null
      thinkingEffort: string
    }>(
      this,
      `
        SELECT
          a.id,
          a.name,
          p.name AS providerName,
          a.model_id AS modelId,
          a.thinking_effort AS thinkingEffort
        FROM agents a
        INNER JOIN agent_profiles p ON p.id = a.provider_id
        WHERE a.name = ?
        LIMIT 1
      `,
      [name],
    )
  }, { timeout: 12_000 }).toMatchObject({
    name,
    providerName,
    modelId,
    thinkingEffort,
  })
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

Then('数据库中不应存在名称为{string}的 Agent', async function (this: CradleWorld, name: string) {
  console.warn(`[step] assert agent missing from database: ${name}`)
  await expect.poll(async () => {
    return queryDatabaseRow<{ id: string }>(
      this,
      `
        SELECT id
        FROM agents
        WHERE name = ?
        LIMIT 1
      `,
      [name],
    )
  }, { timeout: 10_000 }).toBeNull()
})
