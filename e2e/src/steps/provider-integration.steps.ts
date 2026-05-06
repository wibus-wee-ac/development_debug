import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import { MockLlmServer } from '../support/mock-llm-server'
import type { CradleWorld } from '../support/world'

// ── Configuration Steps ─────────────────────────────────────────────────────

When('我通过 IPC 创建一个 Codex provider profile', async function (this: CradleWorld) {
  console.warn('[step] create Codex provider profile via IPC')
  await this.page.evaluate(async () => {
    // eslint-disable-next-line ts/no-explicit-any
    const ipcRenderer = (window as any).electron?.ipcRenderer
    if (!ipcRenderer?.invoke) {
      throw new Error('electron.ipcRenderer not available')
    }
    await ipcRenderer.invoke('agentRuntime.upsertProfile', {
      id: 'codex-test-profile',
      name: 'Codex Test',
      providerKind: 'codex',
      enabled: true,
      configJson: JSON.stringify({
        baseUrl: 'https://api.openai.com/v1',
        model: 'codex-mini-latest',
      }),
      credentialRef: null,
    })
  })
  this.remember('lastProfileId', 'codex-test-profile')
})

When('我通过 IPC 创建一个 Claude Agent provider profile', async function (this: CradleWorld) {
  console.warn('[step] create Claude Agent provider profile via IPC')
  await this.page.evaluate(async () => {
    // eslint-disable-next-line ts/no-explicit-any
    const ipcRenderer = (window as any).electron?.ipcRenderer
    if (!ipcRenderer?.invoke) {
      throw new Error('electron.ipcRenderer not available')
    }
    await ipcRenderer.invoke('agentRuntime.upsertProfile', {
      id: 'claude-agent-test-profile',
      name: 'Claude Agent Test',
      providerKind: 'claude-agent',
      enabled: true,
      configJson: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
      }),
      credentialRef: null,
    })
  })
  this.remember('lastProfileId', 'claude-agent-test-profile')
})

Then('该 profile 应出现在 profile 列表中', async function (this: CradleWorld) {
  console.warn('[step] assert profile exists in list')
  const profileId = this.recall<string>('lastProfileId')
  const profiles = await this.page.evaluate(async () => {
    // eslint-disable-next-line ts/no-explicit-any
    const ipcRenderer = (window as any).electron?.ipcRenderer
    return await ipcRenderer.invoke('agentRuntime.listProfiles')
  }) as Array<{ id: string }>

  const found = profiles.find(p => p.id === profileId)
  expect(found).toBeDefined()
})

Then('该 profile 的 providerKind 应为{string}', async function (this: CradleWorld, expectedKind: string) {
  console.warn(`[step] assert providerKind is ${expectedKind}`)
  const profileId = this.recall<string>('lastProfileId')
  const profile = await this.page.evaluate(async ({ id }) => {
    // eslint-disable-next-line ts/no-explicit-any
    const ipcRenderer = (window as any).electron?.ipcRenderer
    return await ipcRenderer.invoke('agentRuntime.getProfile', id)
  }, { id: profileId }) as { providerKind: string }

  expect(profile.providerKind).toBe(expectedKind)
})

// ── Mock Server Profile Steps ───────────────────────────────────────────────

Given('我已配置指向 Mock 服务的 Codex provider profile', async function (this: CradleWorld) {
  console.warn('[step] configure Codex profile pointing to mock server')
  if (this.mockLlmServer) {
    await this.mockLlmServer.stop()
  }
  this.mockLlmServer = new MockLlmServer({
    models: [
      { id: 'codex-mini-latest', owned_by: 'openai' },
      { id: 'o4-mini', owned_by: 'openai' },
    ],
  })
  this.mockLlmBaseUrl = await this.mockLlmServer.start()

  await this.page.evaluate(async ({ baseUrl }) => {
    // eslint-disable-next-line ts/no-explicit-any
    const ipcRenderer = (window as any).electron?.ipcRenderer
    await ipcRenderer.invoke('agentRuntime.upsertProfile', {
      id: 'codex-mock-profile',
      name: 'Codex (Mock)',
      providerKind: 'codex',
      enabled: true,
      configJson: JSON.stringify({
        baseUrl,
        model: 'codex-mini-latest',
        apiKey: 'test-key',
      }),
      credentialRef: null,
    })
  }, { baseUrl: this.mockLlmBaseUrl })

  this.remember('lastProfileId', 'codex-mock-profile')
})

Given('我已配置指向 Mock 服务的 Claude Agent provider profile', async function (this: CradleWorld) {
  console.warn('[step] configure Claude Agent profile pointing to mock server')
  if (this.mockLlmServer) {
    await this.mockLlmServer.stop()
  }
  this.mockLlmServer = new MockLlmServer({
    models: [
      { id: 'claude-sonnet-4-20250514', owned_by: 'anthropic' },
      { id: 'claude-opus-4-20250514', owned_by: 'anthropic' },
    ],
  })
  this.mockLlmBaseUrl = await this.mockLlmServer.start()

  await this.page.evaluate(async ({ baseUrl }) => {
    // eslint-disable-next-line ts/no-explicit-any
    const ipcRenderer = (window as any).electron?.ipcRenderer
    await ipcRenderer.invoke('agentRuntime.upsertProfile', {
      id: 'claude-agent-mock-profile',
      name: 'Claude Agent (Mock)',
      providerKind: 'claude-agent',
      enabled: true,
      configJson: JSON.stringify({
        baseUrl,
        model: 'claude-sonnet-4-20250514',
        apiKey: 'test-key',
      }),
      credentialRef: null,
    })
  }, { baseUrl: this.mockLlmBaseUrl })

  this.remember('lastProfileId', 'claude-agent-mock-profile')
})

// ── Model Listing Steps ─────────────────────────────────────────────────────

When('我请求该 profile 的模型列表', async function (this: CradleWorld) {
  console.warn('[step] request model list for profile')
  const profileId = this.recall<string>('lastProfileId')
  const models = await this.page.evaluate(async ({ id }) => {
    // eslint-disable-next-line ts/no-explicit-any
    const ipcRenderer = (window as any).electron?.ipcRenderer
    return await ipcRenderer.invoke('agentRuntime.listModels', id)
  }, { id: profileId }) as Array<{ id: string }>

  this.remember('modelList', models)
})

Then('模型列表应包含至少一个模型', async function (this: CradleWorld) {
  console.warn('[step] assert model list has entries')
  const models = this.recall<Array<{ id: string }>>('modelList')
  expect(models.length).toBeGreaterThanOrEqual(1)
})

// ── Tool Call Steps ─────────────────────────────────────────────────────────

Given('我已配置带工具调用的 Mock LLM Provider', async function (this: CradleWorld) {
  console.warn('[step] configure mock LLM with tool calls')
  await this.configureMockLlmProvider({
    responseText: 'Hello from mock LLM!',
  })
})

// ── Probe Steps ─────────────────────────────────────────────────────────────

When('我探测该 profile', async function (this: CradleWorld) {
  console.warn('[step] probe profile')
  const profileId = this.recall<string>('lastProfileId')
  const result = await this.page.evaluate(async ({ id }) => {
    // eslint-disable-next-line ts/no-explicit-any
    const ipcRenderer = (window as any).electron?.ipcRenderer
    return await ipcRenderer.invoke('agentRuntime.probeProfile', id)
  }, { id: profileId }) as { ok: boolean }

  this.remember('probeResult', result)
})

Then('探测结果应为成功', async function (this: CradleWorld) {
  console.warn('[step] assert probe result is ok')
  const result = this.recall<{ ok: boolean }>('probeResult')
  expect(result.ok).toBe(true)
})

// ── UI Flow Steps ───────────────────────────────────────────────────────────

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

When('我在 Provider 表单填写 Base URL 为 Mock 地址', async function (this: CradleWorld) {
  console.warn('[step] fill provider baseUrl with mock address')
  // Start a mock server for the UI test
  if (this.mockLlmServer) {
    await this.mockLlmServer.stop()
  }
  this.mockLlmServer = new MockLlmServer({
    models: [
      { id: 'codex-mini-latest', owned_by: 'openai' },
      { id: 'claude-sonnet-4-20250514', owned_by: 'anthropic' },
    ],
  })
  this.mockLlmBaseUrl = await this.mockLlmServer.start()

  const input = this.page.locator('[data-testid="provider-baseurl"]')
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.clear()
  await input.fill(this.mockLlmBaseUrl)
})

When('我在 Provider 表单填写 Model 为{string}', async function (this: CradleWorld, model: string) {
  console.warn(`[step] fill provider model: ${model}`)
  const input = this.page.locator('[data-testid="provider-model"]')
  await expect(input).toBeVisible({ timeout: 5000 })
  await input.clear()
  await input.fill(model)
})

When('我在 Provider 表单填写 API Key 为{string}', async function (this: CradleWorld, apiKey: string) {
  console.warn(`[step] fill provider apiKey`)
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

Then('Provider 状态应为成功', async function (this: CradleWorld) {
  console.warn('[step] assert provider status is success')
  const status = this.page.locator('[data-testid="provider-status"]')
  await expect(status).toBeVisible({ timeout: 15000 })
  const isOk = await status.getAttribute('data-status-ok')
  expect(isOk).toBe('true')
})
