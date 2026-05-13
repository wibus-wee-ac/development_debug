// Input: Cucumber steps, Playwright assertions, temp skill fixtures, SQLite lookups, and real Settings provider/agent creation flow
// Output: End-to-end step definitions for global/workspace/agent skills management through visible UI journeys
// Position: Skills feature automation bridging native directory picker mocks, renderer interactions, and minimal setup lookups

import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import { MockLlmServer } from '../support/mock-llm-server'
import type { CradleWorld } from '../support/world'

const DEFAULT_PROVIDER_MODEL = 'skills-mock-model'
const IMPORTED_DEMO_RE = /^imported-demo\b/
const NON_SLUG_CHAR_RE = /[^a-z0-9]+/g
const EDGE_DASH_RE = /^-+|-+$/g
const CRLF_RE = /\r\n/g
const REGEXP_SPECIAL_CHAR_RE = /[.*+?^${}()|[\]\\]/g

function createTempDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now().toString(36)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function slugifyName(name: string): string {
  return name.trim().toLowerCase().replace(NON_SLUG_CHAR_RE, '-').replace(EDGE_DASH_RE, '') || 'skills'
}

function escapeRegExp(value: string): string {
  return value.replace(REGEXP_SPECIAL_CHAR_RE, '\\$&')
}

function normalizeMultiline(value: string): string {
  return value.replace(CRLF_RE, '\n').trim()
}

function createSkillPackage(dir: string, skillName: string, description: string, body: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${skillName}\ndescription: ${description}\n---\n\n${body}`,
    'utf8',
  )
}

function skillButton(world: CradleWorld, skillName: string) {
  return world.page.getByRole('button', { name: new RegExp(`^${escapeRegExp(skillName)}\\b`) }).first()
}

function agentSkillsPageSelector(agentId?: string): string {
  return agentId ? `[data-testid="agent-skills-${agentId}"]` : '[data-testid^="agent-skills-"]'
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
  await expect(navItem).toBeVisible({ timeout: 10_000 })
  await navItem.click()
  await expect(world.page.locator(pageSelector)).toBeVisible({ timeout: 10_000 })
}

async function selectOption(world: CradleWorld, triggerSelector: string, value: string): Promise<void> {
  const trigger = world.page.locator(triggerSelector)
  await expect(trigger).toBeVisible({ timeout: 10_000 })
  await trigger.click()

  const option = world.page.getByRole('option', { name: value })
  await expect(option).toBeVisible({ timeout: 10_000 })
  await option.click()
}

async function startSkillsMockProvider(world: CradleWorld): Promise<string> {
  if (world.mockLlmServer) {
    await world.mockLlmServer.stop()
  }

  world.mockLlmServer = new MockLlmServer({
    models: [
      { id: DEFAULT_PROVIDER_MODEL, owned_by: 'skills-e2e' },
    ],
  })
  world.mockLlmBaseUrl = await world.mockLlmServer.start()
  return world.mockLlmBaseUrl
}

async function createProviderViaUi(world: CradleWorld, providerName: string): Promise<void> {
  const baseUrl = await startSkillsMockProvider(world)

  await openSettingsSection(world, 'settings-nav-providers', '[data-testid="agent-runtime-settings"]')

  const addProviderButton = world.page.locator('[data-testid="add-provider-btn"]')
  await expect(addProviderButton).toBeVisible({ timeout: 10_000 })
  await addProviderButton.click()

  await selectOption(world, '[data-testid="agent-provider-kind"]', 'OpenAI-compatible')

  const nameInput = world.page.locator('[data-testid="provider-name"]')
  await expect(nameInput).toBeVisible({ timeout: 10_000 })
  await nameInput.fill(providerName)

  const baseUrlInput = world.page.locator('[data-testid="provider-baseurl"]')
  await expect(baseUrlInput).toBeVisible({ timeout: 10_000 })
  await baseUrlInput.fill(baseUrl)

  const modelInput = world.page.locator('[data-testid="provider-model"]')
  await expect(modelInput).toBeVisible({ timeout: 10_000 })
  await modelInput.fill(DEFAULT_PROVIDER_MODEL)

  const apiKeyInput = world.page.locator('[data-testid="provider-apikey"]')
  await expect(apiKeyInput).toBeVisible({ timeout: 10_000 })
  await apiKeyInput.fill('skills-test-key')

  const submitButton = world.page.locator('[data-testid="provider-submit"]')
  await expect(submitButton).toBeVisible({ timeout: 10_000 })
  await submitButton.click()

  const providerRow = world.page.locator('[data-testid^="agent-profile-row-"]').filter({ hasText: providerName }).first()
  await expect(providerRow).toBeVisible({ timeout: 15_000 })
}

async function createAgentViaUi(world: CradleWorld, agentName: string): Promise<void> {
  const providerName = `Skills Mock Provider ${slugifyName(agentName)}`
  await createProviderViaUi(world, providerName)

  await openSettingsSection(world, 'settings-nav-agents', '[data-testid="agent-list"]')

  const newAgentButton = world.page.locator('[data-testid="new-agent-btn"]')
  await expect(newAgentButton).toBeVisible({ timeout: 10_000 })
  await newAgentButton.click()

  const nameInput = world.page.locator('[data-testid="agent-detail-name"]')
  await expect(nameInput).toBeVisible({ timeout: 10_000 })
  await nameInput.fill(agentName)

  await selectOption(world, '[data-testid="agent-provider-select"]', providerName)
  const modelTrigger = world.page.locator('[data-testid="agent-model-select"]')
  await expect(modelTrigger).toBeVisible({ timeout: 10_000 })
  await expect(modelTrigger).toContainText(DEFAULT_PROVIDER_MODEL, { timeout: 10_000 })

  const saveButton = world.page.locator('[data-testid="agent-detail-save"]')
  await expect(saveButton).toBeEnabled({ timeout: 10_000 })
  await saveButton.click()

  await expect(world.page.locator('[data-testid="agent-detail-delete-trigger"]')).toBeVisible({ timeout: 10_000 })

  const backButton = world.page.locator('[data-testid="agent-detail-back"]')
  await expect(backButton).toBeVisible({ timeout: 10_000 })
  await backButton.click()

  const row = world.page.locator('[data-testid^="agent-row-"]').filter({ hasText: agentName }).first()
  await expect(row).toBeVisible({ timeout: 10_000 })
}

async function openSkill(world: CradleWorld, skillName: string): Promise<void> {
  const button = skillButton(world, skillName)
  await expect(button).toBeVisible({ timeout: 10_000 })
  await button.click()
  await expect(world.page.locator('[data-testid="skill-export-btn"]')).toBeVisible({ timeout: 10_000 })
}

async function ensureSkillEditDialogOpen(world: CradleWorld): Promise<void> {
  const saveButton = world.page.locator('[data-testid="skill-save-btn"]')
  if (await saveButton.isVisible().catch(() => false)) {
    return
  }

  const editButton = world.page.locator('[data-testid="skill-edit-btn"]')
  await expect(editButton).toBeVisible({ timeout: 10_000 })
  await editButton.click()
  await expect(saveButton).toBeVisible({ timeout: 10_000 })
}

function currentSkillDetailDialog(world: CradleWorld) {
  return world.page.getByRole('dialog').filter({ hasText: 'Skill Detail' }).first()
}

When('我点击"Skills"导航项', async function (this: CradleWorld) {
  const navItem = this.page.locator('[data-testid="settings-nav-skills"]')
  await expect(navItem).toBeVisible({ timeout: 5000 })
  await navItem.click()
})

Given('我已进入全局 Skills 页面', async function (this: CradleWorld) {
  await openSettingsSection(this, 'settings-nav-skills', '[data-testid="global-skills-page"]')
})

Then('我应该看到全局 Skills 页面', async function (this: CradleWorld) {
  await expect(this.page.locator('[data-testid="global-skills-page"]')).toBeVisible({ timeout: 5000 })
})

When('我新建一个全局 Skill', async function (this: CradleWorld) {
  await this.page.locator('[data-testid="new-skill-btn"]').click()
  await this.page.locator('[data-testid="skill-name-input"]').fill('global-demo')
  await this.page.locator('[data-testid="skill-desc-input"]').fill('Global demo skill')
  await this.page.locator('[data-testid="skill-body-editor"]').fill('# Global Demo\n\nUse this skill carefully.')
  await this.page.locator('[data-testid="skill-save-btn"]').click()
})

Then('我应该看到全局 Skill {string}', async function (this: CradleWorld, skillName: string) {
  await expect(this.page.getByRole('button', { name: new RegExp(`^${skillName}\\b`) })).toBeVisible({ timeout: 5000 })
})

Given('我准备了一个待导入的 Skill 目录', async function (this: CradleWorld) {
  const rootDir = createTempDir('cradle-import-skill')
  const skillDir = join(rootDir, 'imported-demo')
  createSkillPackage(skillDir, 'imported-demo', 'Imported demo skill', '# Imported Demo')
  this.skillImportSourceDir = skillDir
  this.skillExportDir = createTempDir('cradle-export-skill')
})

When('我导入这个全局 Skill', async function (this: CradleWorld) {
  await this.page.locator('[data-testid="skill-import-btn"]').click()

  const dialog = this.page.locator('[data-testid="skill-import-dialog"]')
  await expect(dialog).toBeVisible({ timeout: 5000 })

  const sourceInput = dialog.locator('[data-testid="skill-import-source-input"]')
  await expect(sourceInput).toBeVisible({ timeout: 5000 })
  await sourceInput.fill(this.skillImportSourceDir!)

  const fetchButton = dialog.locator('[data-testid="skill-import-fetch-btn"]')
  await expect(fetchButton).toBeEnabled({ timeout: 5000 })
  await fetchButton.click()

  const installButton = dialog.locator('[data-testid="skill-import-install-btn"]')
  await expect(installButton).toBeVisible({ timeout: 10000 })
  await expect(installButton).toBeEnabled({ timeout: 10000 })
  await installButton.click()

  const doneButton = dialog.locator('[data-testid="skill-import-done-btn"]')
  await expect(doneButton).toBeVisible({ timeout: 10000 })
  await doneButton.click()

  await expect(dialog).toHaveCount(0, { timeout: 5000 })
  await expect(this.page.getByRole('button', { name: IMPORTED_DEMO_RE })).toBeVisible({ timeout: 10000 })
})

Given('我已打开一个工作区详情页', async function (this: CradleWorld) {
  const workspaceDir = createTempDir('cradle-skills-workspace')
  this.skillWorkspaceDir = workspaceDir

  const addBtn = this.page.locator('[data-testid="add-workspace-btn"]')
  await expect(addBtn).toBeVisible({ timeout: 15000 })
  await addBtn.click()

  await this.selectDirectoryInBrowser(workspaceDir)

  await this.page.getByText('cradle-skills-workspace', { exact: false }).click()
  await expect(this.page.locator('[data-testid="workspace-detail-page"]')).toBeVisible({ timeout: 5000 })
})

When('我切换到 Workspace Skills 标签', async function (this: CradleWorld) {
  await this.page.locator('[data-testid="workspace-detail-tab-skills"]').click()
  await expect(this.page.locator('[data-testid="workspace-skills-page"]')).toBeVisible({ timeout: 5000 })
})

When('我新建一个工作区 Skill', async function (this: CradleWorld) {
  await this.page.locator('[data-testid="new-skill-btn"]').click()
  await this.page.locator('[data-testid="skill-name-input"]').fill('workspace-demo')
  await this.page.locator('[data-testid="skill-desc-input"]').fill('Workspace demo skill')
  await this.page.locator('[data-testid="skill-body-editor"]').fill('# Workspace Demo\n\nScoped to one repo.')
  await this.page.locator('[data-testid="skill-save-btn"]').click()
})

Then('我应该看到工作区 Skill {string}', async function (this: CradleWorld, skillName: string) {
  await expect(this.page.getByRole('button', { name: new RegExp(`^${skillName}\\b`) })).toBeVisible({ timeout: 5000 })
})

Given('我已通过真实 Settings UI 创建一个 Agent {string}', async function (this: CradleWorld, agentName: string) {
  await createAgentViaUi(this, agentName)
})

When('我打开 Agent {string} 的 Skills 管理', async function (this: CradleWorld, agentName: string) {
  const row = this.page.locator('[data-testid^="agent-row-"]').filter({ hasText: agentName }).first()
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.click()
  await expect(this.page.locator(agentSkillsPageSelector()).first()).toBeVisible({ timeout: 5000 })
})

When('我新建一个 Agent Skill', async function (this: CradleWorld) {
  await expect(this.page.locator(agentSkillsPageSelector()).first()).toBeVisible({ timeout: 5000 })
  await this.page.locator('[data-testid="new-skill-btn"]').click()
  await this.page.locator('[data-testid="skill-name-input"]').fill('agent-demo')
  await this.page.locator('[data-testid="skill-desc-input"]').fill('Agent demo skill')
  await this.page.locator('[data-testid="skill-body-editor"]').fill('# Agent Demo\n\nPrivate to one agent.')
  await this.page.locator('[data-testid="skill-save-btn"]').click()
})

Then('我应该看到 Agent Skills 页面', async function (this: CradleWorld) {
  await expect(this.page.locator(agentSkillsPageSelector()).first()).toBeVisible({ timeout: 5000 })
})

Then('我应该看到 Agent Skill {string}', async function (this: CradleWorld, skillName: string) {
  await expect(this.page.getByRole('button', { name: new RegExp(`^${skillName}\\b`) })).toBeVisible({ timeout: 5000 })
})

When('我打开 Skill {string}', async function (this: CradleWorld, skillName: string) {
  await openSkill(this, skillName)
})

When('我编辑当前 Skill 名称为 {string}', async function (this: CradleWorld, nextName: string) {
  await ensureSkillEditDialogOpen(this)
  await this.page.locator('[data-testid="skill-name-input"]').fill(nextName)
})

When('我编辑当前 Skill 描述为 {string}', async function (this: CradleWorld, nextDescription: string) {
  await ensureSkillEditDialogOpen(this)
  await this.page.locator('[data-testid="skill-desc-input"]').fill(nextDescription)
})

When('我编辑当前 Skill 内容为:', async function (this: CradleWorld, docString: string) {
  await ensureSkillEditDialogOpen(this)
  await this.page.locator('[data-testid="skill-body-editor"]').fill(docString)
})

When('我保存当前 Skill', async function (this: CradleWorld) {
  const saveButton = this.page.locator('[data-testid="skill-save-btn"]')
  await expect(saveButton).toBeVisible({ timeout: 10_000 })
  await saveButton.click()
  await expect(saveButton).toHaveCount(0, { timeout: 10_000 })
})

When('我删除当前 Skill', async function (this: CradleWorld) {
  const deleteButton = this.page.locator('[data-testid="skill-delete-btn"]')
  await expect(deleteButton).toBeVisible({ timeout: 10_000 })
  await deleteButton.click()
  await expect(deleteButton).toHaveCount(0, { timeout: 10_000 })
})

Then('我不应该看到 Skill {string}', async function (this: CradleWorld, skillName: string) {
  await expect(skillButton(this, skillName)).toHaveCount(0, { timeout: 10_000 })
})

Then('当前 Skill 详情应显示描述为 {string}', async function (this: CradleWorld, description: string) {
  const dialog = currentSkillDetailDialog(this)
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await expect(dialog).toContainText(description, { timeout: 10_000 })
})

Then('当前 Skill 详情应显示内容为:', async function (this: CradleWorld, docString: string) {
  const dialog = currentSkillDetailDialog(this)
  const content = dialog.locator('pre').first()

  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await expect(content).toBeVisible({ timeout: 10_000 })

  for (const line of normalizeMultiline(docString).split('\n').map(line => line.trim()).filter(Boolean)) {
    await expect(content).toContainText(line, { timeout: 10_000 })
  }
})
