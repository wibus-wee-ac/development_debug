// Input: Cucumber steps, Playwright assertions, temp skill fixtures, CradleWorld support helpers
// Output: End-to-end step definitions for global/workspace skills management and agent-private skill roots
// Position: Skills feature automation bridging filesystem fixtures, mocked native dialogs, and renderer interactions

import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import { CradleWorld } from '../support/world.ts'

function createTempDir(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now().toString(36)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function createSkillPackage(dir: string, skillName: string, description: string, body: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${skillName}\ndescription: ${description}\n---\n\n${body}`,
    'utf8',
  )
}

function agentSkillsPageSelector(agentId?: string): string {
  return agentId ? `[data-testid="agent-skills-${agentId}"]` : '[data-testid^="agent-skills-"]'
}

When('我点击"Skills"导航项', async function (this: CradleWorld) {
  const navItem = this.page.locator('[data-testid="settings-nav-skills"]')
  await expect(navItem).toBeVisible({ timeout: 5000 })
  await navItem.click()
})

Given('我已进入全局 Skills 页面', async function (this: CradleWorld) {
  const settingsBtn = this.page.locator('[data-testid="settings-btn"]')
  await expect(settingsBtn).toBeVisible({ timeout: 15000 })
  await settingsBtn.click()

  const navItem = this.page.locator('[data-testid="settings-nav-skills"]')
  await expect(navItem).toBeVisible({ timeout: 5000 })
  await navItem.click()

  await expect(this.page.locator('[data-testid="global-skills-page"]')).toBeVisible({ timeout: 5000 })
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

Then('全局 Skill {string} 应该写入磁盘', async function (this: CradleWorld, skillName: string) {
  const skillPath = join(CradleWorld.e2eHomePath, '.cradle', 'skills', skillName, 'SKILL.md')
  await expect.poll(async () => {
    const fs = await import('node:fs')
    return fs.existsSync(skillPath)
  }).toBe(true)
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
  await expect(this.page.getByRole('button', { name: /^imported-demo\b/ })).toBeVisible({ timeout: 10000 })
})

When('我导出全局 Skill {string}', async function (this: CradleWorld, skillName: string) {
  await this.app.evaluate(async ({ dialog }, dirPath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [dirPath],
    })
  }, this.skillExportDir)

  await this.page.getByRole('button', { name: new RegExp(`^${skillName}\\b`) }).click()
  await this.page.locator('[data-testid="skill-export-btn"]').click()
})

Then('导出的 Skill 包应该保留 SKILL.md', async function (this: CradleWorld) {
  await expect.poll(async () => {
    const fs = await import('node:fs')
    return fs.existsSync(join(this.skillExportDir!, 'imported-demo', 'SKILL.md'))
  }).toBe(true)
})

Given('我已打开一个工作区详情页', async function (this: CradleWorld) {
  const workspaceDir = createTempDir('cradle-skills-workspace')
  this.skillWorkspaceDir = workspaceDir

  await this.app.evaluate(async ({ dialog }, dirPath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [dirPath],
    })
  }, workspaceDir)

  const addBtn = this.page.locator('[data-testid="add-workspace-btn"]')
  await expect(addBtn).toBeVisible({ timeout: 15000 })
  await addBtn.click()

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

Then('Workspace Skill {string} 应该写入磁盘', async function (this: CradleWorld, skillName: string) {
  const skillPath = join(this.skillWorkspaceDir!, '.agents', 'skills', skillName, 'SKILL.md')
  await expect.poll(async () => {
    const fs = await import('node:fs')
    return fs.existsSync(skillPath)
  }).toBe(true)
})

Given('我已创建一个 Agent {string}', async function (this: CradleWorld, agentName: string) {
  const createdAgentId = await this.page.evaluate(async ({ name }) => {
    const invoke = window.electron.ipcRenderer.invoke.bind(window.electron.ipcRenderer)
    const providerId = 'e2e-openai-provider'

    await invoke('agentRuntime.upsertProfile', {
      id: providerId,
      name: 'E2E OpenAI',
      providerKind: 'openai-compatible',
      enabled: true,
      configJson: JSON.stringify({
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o',
      }),
      credentialRef: null,
    })

    const agent = await invoke('agent.create', {
      name,
      description: null,
      avatarStyle: 'bottts-neutral',
      avatarSeed: 'e2e-skill-agent',
      providerId,
      modelId: null,
      thinkingEffort: 'auto',
      configJson: '{}',
    })

    return agent.id as string
  }, { name: agentName })

  await this.page.reload()
  await this.page.locator('[data-testid="settings-btn"]').click()
  await this.page.locator('[data-testid="settings-nav-agents"]').click()
  const row = this.page.locator(`[data-testid="agent-row-${createdAgentId}"]`)
  await expect(row).toBeVisible({ timeout: 5000 })
  this.skillAgentIds[agentName] = createdAgentId
})

When('我打开 Agent {string} 的 Skills 管理', async function (this: CradleWorld, agentName: string) {
  const agentId = this.skillAgentIds[agentName]
  const row = agentId
    ? this.page.locator(`[data-testid="agent-row-${agentId}"]`)
    : this.page.locator('[data-testid^="agent-row-"]').filter({ hasText: agentName }).first()
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.click()
  await expect(this.page.locator(agentSkillsPageSelector(agentId))).toBeVisible({ timeout: 5000 })
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

Then('Agent {string} 的 Skill {string} 应该写入磁盘', async function (this: CradleWorld, agentName: string, skillName: string) {
  const agentId = this.skillAgentIds[agentName]
  const skillPath = join(CradleWorld.e2eHomePath, '.cradle', 'agents', agentId, 'skills', skillName, 'SKILL.md')
  await expect.poll(async () => {
    const fs = await import('node:fs')
    return fs.existsSync(skillPath)
  }).toBe(true)
})
