import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import { MockLlmServer } from '../support/mock-llm-server'
import type { CradleWorld } from '../support/world'

const EMPTY_STATE_RE = /还没有 Agent Profile|No agent profiles|No providers configured yet\./
const NON_SLUG_CHAR_RE = /[^a-z0-9]+/g
const EDGE_DASH_RE = /^-+|-+$/g

function slugifyName(name: string): string {
  return name.trim().toLowerCase().replace(NON_SLUG_CHAR_RE, '-').replace(EDGE_DASH_RE, '') || 'provider'
}

function parseEnabledState(enabledText: string): boolean {
  if (enabledText === '启用') {
    return true
  }
  if (enabledText === '禁用') {
    return false
  }
  throw new Error(`Unknown provider enabled state: ${enabledText}`)
}

function getProviderRows(world: CradleWorld, name: string) {
  return world.page.locator('[data-testid^="agent-profile-row-"]').filter({ hasText: name })
}

async function createOpenAICompatibleProvider(
  world: CradleWorld,
  options: { name: string, baseUrl: string, model: string, enabled: boolean },
) {
  const profileId = `e2e-provider-${slugifyName(options.name)}`

  await world.page.evaluate(async ({ profileId, ...input }) => {
    // eslint-disable-next-line ts/no-explicit-any
    const ipcRenderer = (window as any).electron?.ipcRenderer
    if (!ipcRenderer?.invoke) {
      throw new Error('electron.ipcRenderer not available')
    }

    await ipcRenderer.invoke('agentRuntime.upsertProfile', {
      id: profileId,
      name: input.name,
      providerKind: 'openai-compatible',
      enabled: input.enabled,
      configJson: JSON.stringify({
        baseUrl: input.baseUrl,
        model: input.model,
      }),
      credentialRef: null,
    })
  }, { profileId, ...options })
}

async function ensureMockProviderBaseUrl(world: CradleWorld): Promise<string> {
  if (world.mockLlmServer) {
    await world.mockLlmServer.stop()
  }

  world.mockLlmServer = new MockLlmServer({
    models: [
      { id: 'mock-model', owned_by: 'openai' },
      { id: 'codex-mini-latest', owned_by: 'openai' },
      { id: 'claude-sonnet-4-20250514', owned_by: 'anthropic' },
    ],
  })
  world.mockLlmBaseUrl = await world.mockLlmServer.start()
  return world.mockLlmBaseUrl
}

When('我点击设置按钮', async function (this: CradleWorld) {
  console.warn('[step] click settings button')
  const btn = this.page.locator('[data-testid="settings-btn"]')
  await expect(btn).toBeVisible({ timeout: 15000 })
  await btn.click()
})

When('我点击添加 Provider 按钮', async function (this: CradleWorld) {
  console.warn('[step] click Add Provider button')
  const btn = this.page.locator('[data-testid="add-provider-btn"]')
  await expect(btn).toBeVisible({ timeout: 5000 })
  await btn.click()
})

When('我在 Provider 类型下拉选择{string}', async function (this: CradleWorld, kindLabel: string) {
  console.warn(`[step] select provider kind: ${kindLabel}`)
  const trigger = this.page.locator('[data-testid="agent-provider-kind"]')
  await expect(trigger).toBeVisible({ timeout: 5000 })
  await trigger.click()
  const option = this.page.getByRole('option', { name: kindLabel })
  await expect(option).toBeVisible({ timeout: 5000 })
  await option.click()
})

When('我点击"Providers"导航项', async function (this: CradleWorld) {
  console.warn('[step] click Providers nav item')
  const navItem = this.page.locator('[data-testid="settings-nav-providers"]')
  await expect(navItem).toBeVisible({ timeout: 5000 })
  await navItem.click()
})

Given('我已进入 Agent Runtime 设置页面', async function (this: CradleWorld) {
  console.warn('[step] navigate to Agent Runtime settings')
  const settingsBtn = this.page.locator('[data-testid="settings-btn"]')
  await expect(settingsBtn).toBeVisible({ timeout: 15000 })
  await settingsBtn.click()

  const navItem = this.page.locator('[data-testid="settings-nav-providers"]')
  await expect(navItem).toBeVisible({ timeout: 5000 })
  await navItem.click()

  const settings = this.page.locator('[data-testid="agent-runtime-settings"]')
  await expect(settings).toBeVisible({ timeout: 5000 })
})

Then('我应该看到 Agent Runtime 设置页面', async function (this: CradleWorld) {
  console.warn('[step] assert Agent Runtime settings visible')
  const settings = this.page.locator('[data-testid="agent-runtime-settings"]')
  await expect(settings).toBeVisible({ timeout: 10000 })
})

Then('我应该看到 Provider 类型选择', async function (this: CradleWorld) {
  console.warn('[step] assert provider kind selector visible')
  const addButton = this.page.getByRole('button', { name: /Add Provider|Add/i })
  await expect(addButton).toBeVisible({ timeout: 5000 })
  await addButton.click()
  const selector = this.page.locator('[data-testid="agent-provider-kind"]')
  await expect(selector).toBeVisible({ timeout: 5000 })
})

Then('我应该看到 Agent Profile 列表或空状态', async function (this: CradleWorld) {
  console.warn('[step] assert profile list or empty state visible')
  const settings = this.page.locator('[data-testid="agent-runtime-settings"]')
  await expect(settings).toBeVisible({ timeout: 5000 })

  const emptyText = settings.getByText(EMPTY_STATE_RE)
  const providerRows = settings.locator('[role="switch"]')

  const hasProfiles = (await providerRows.count()) > 0
  const hasEmpty = await emptyText.isVisible().catch(() => false)

  expect(hasProfiles || hasEmpty).toBeTruthy()
})

When('我在 Provider 表单填写 Name 为{string}', async function (this: CradleWorld, name: string) {
  console.warn(`[step] fill provider name: ${name}`)
  const input = this.page.locator('[data-testid="provider-name"]')
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.clear()
  await input.fill(name)
})

When('我在 Provider 表单填写 Base URL 为 Mock 地址', async function (this: CradleWorld) {
  console.warn('[step] fill provider baseUrl with mock address')
  const input = this.page.locator('[data-testid="provider-baseurl"]')
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.clear()
  await input.fill(await ensureMockProviderBaseUrl(this))
})

When('我在 Provider 表单填写 Model 为{string}', async function (this: CradleWorld, model: string) {
  console.warn(`[step] fill provider model: ${model}`)
  const input = this.page.locator('[data-testid="provider-model"]')
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.clear()
  await input.fill(model)
})

When('我在 Provider 表单填写 API Key 为{string}', async function (this: CradleWorld, apiKey: string) {
  console.warn('[step] fill provider apiKey')
  const input = this.page.locator('[data-testid="provider-apikey"]')
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.clear()
  await input.fill(apiKey)
})

When('我点击提交 Provider 按钮', async function (this: CradleWorld) {
  console.warn('[step] click submit Provider button')
  const btn = this.page.locator('[data-testid="provider-submit"]')
  await expect(btn).toBeVisible({ timeout: 5000 })
  await btn.click()
})

Then('Provider 列表中应显示名为{string}的 profile', async function (this: CradleWorld, name: string) {
  console.warn(`[step] assert provider row visible: ${name}`)
  const row = this.page.locator('[data-testid^="agent-profile-row-"]').filter({ hasText: name })
  await expect(row).toBeVisible({ timeout: 10_000 })
})

Then('Provider 状态应为成功', async function (this: CradleWorld) {
  console.warn('[step] assert provider status is success')
  const status = this.page.locator('[data-testid="provider-status"]')
  await expect(status).toBeVisible({ timeout: 15_000 })
  await expect(status).toHaveAttribute('data-status-ok', 'true')
})

Then('Provider 状态应为失败并提示{string}', async function (this: CradleWorld, text: string) {
  console.warn(`[step] assert provider status is failure: ${text}`)
  const status = this.page.locator('[data-testid="provider-status"]')
  await expect(status).toBeVisible({ timeout: 15_000 })
  await expect(status).toHaveAttribute('data-status-ok', 'false')
  await expect(status).toContainText(text)
})

Then('Provider 对话框应保持打开', async function (this: CradleWorld) {
  console.warn('[step] assert provider dialog remains open')
  const dialog = this.page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 5000 })
  await expect(this.page.locator('[data-testid="provider-submit"]')).toBeVisible({ timeout: 5000 })
})

Given('我已有一个名为{string}、Base URL 为{string}、模型为{string}、启用状态为{string}的 OpenAI-compatible Provider', async function (
  this: CradleWorld,
  name: string,
  baseUrl: string,
  model: string,
  enabledText: string,
) {
  console.warn(`[step] prepare existing provider: ${name}`)
  await createOpenAICompatibleProvider(this, {
    name,
    baseUrl,
    model,
    enabled: parseEnabledState(enabledText),
  })
})

When('我打开名为{string}的 Provider', async function (this: CradleWorld, name: string) {
  console.warn(`[step] open provider row: ${name}`)
  const row = getProviderRows(this, name).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.click()
  await expect(this.page.locator('[data-testid="provider-edit-dialog"]')).toBeVisible({ timeout: 10_000 })
})

When('我编辑 Provider Name 为{string}', async function (this: CradleWorld, name: string) {
  console.warn(`[step] edit provider name: ${name}`)
  const input = this.page.locator('[data-testid="provider-edit-name"]')
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.fill(name)
})

When('我编辑 Provider Base URL 为{string}', async function (this: CradleWorld, baseUrl: string) {
  console.warn(`[step] edit provider baseUrl: ${baseUrl}`)
  const input = this.page.locator('[data-testid="provider-edit-baseurl"]')
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.fill(baseUrl)
})

When('我编辑 Provider Model 为{string}', async function (this: CradleWorld, model: string) {
  console.warn(`[step] edit provider model: ${model}`)
  const input = this.page.locator('[data-testid="provider-edit-model"]')
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.fill(model)
})

When('我编辑 Provider API Key 为{string}', async function (this: CradleWorld, apiKey: string) {
  console.warn('[step] edit provider apiKey')
  const input = this.page.locator('[data-testid="provider-edit-apikey"]')
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.fill(apiKey)
})

When('我保存 Provider 编辑', async function (this: CradleWorld) {
  console.warn('[step] save provider edit dialog')
  const button = this.page.locator('[data-testid="provider-edit-save"]')
  await expect(button).toBeEnabled({ timeout: 5000 })
  await button.click()
  await expect(this.page.locator('[data-testid="provider-edit-dialog"]')).toBeHidden({ timeout: 10_000 })
})

Then('Provider 列表中应显示名为{string}、模型为{string}的 profile', async function (
  this: CradleWorld,
  name: string,
  model: string,
) {
  console.warn(`[step] assert provider row/model visible: ${name} -> ${model}`)
  const row = getProviderRows(this, name).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await expect(row).toContainText(name)
  await expect(row).toContainText(model)
})

When('我移除名为{string}的 Provider', async function (this: CradleWorld, name: string) {
  console.warn(`[step] remove provider row: ${name}`)
  const row = getProviderRows(this, name).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  await row.hover()

  const removeButton = row.locator('[data-testid^="agent-profile-remove-"]')
  await expect(removeButton).toBeVisible({ timeout: 5000 })
  await removeButton.click()
})

Then('Provider 列表中不应显示名为{string}的 profile', async function (this: CradleWorld, name: string) {
  console.warn(`[step] assert provider row absent: ${name}`)
  await expect(getProviderRows(this, name)).toHaveCount(0, { timeout: 10_000 })
})

When('我切换名为{string}的 Provider 启用状态', async function (this: CradleWorld, name: string) {
  console.warn(`[step] toggle provider enabled: ${name}`)
  const row = getProviderRows(this, name).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  const toggle = row.locator('[role="switch"]')
  await expect(toggle).toBeVisible({ timeout: 5000 })
  await toggle.click()
})

Then('名为{string}的 Provider 应处于{string}状态', async function (this: CradleWorld, name: string, enabledText: string) {
  console.warn(`[step] assert provider UI enabled state: ${name} -> ${enabledText}`)
  const expected = parseEnabledState(enabledText) ? 'true' : 'false'
  const row = getProviderRows(this, name).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
  const toggle = row.locator('[role="switch"]')
  await expect(toggle).toHaveAttribute('aria-checked', expected, { timeout: 10_000 })
})
