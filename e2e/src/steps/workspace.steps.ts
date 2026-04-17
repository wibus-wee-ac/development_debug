import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world.ts'

// ── Helpers ───────────────────────────────────────────────────────────────────

const runId = Date.now().toString(36)

function createTempWorkspaceDir(): string {
  const dir = join(tmpdir(), `cradle-e2e-ws-${runId}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

// ── Steps ─────────────────────────────────────────────────────────────────────

Then('我应该看到工作区列表为空', async function (this: CradleWorld) {
  console.warn('[step] assert workspace list is empty')
  const list = this.page.locator('[data-testid="workspace-list"]')
  await expect(list).toBeVisible({ timeout: 15000 })

  const emptyBtn = this.page.locator('[data-testid="add-workspace-empty-btn"]')
  await expect(emptyBtn).toBeVisible({ timeout: 15000 })
})

Then('我应该看到"添加工作区"按钮', async function (this: CradleWorld) {
  console.warn('[step] assert add workspace button visible')
  const btn = this.page.locator('[data-testid="add-workspace-btn"]')
  await expect(btn).toBeVisible()
})

When('我通过原生对话框添加工作区', async function (this: CradleWorld) {
  console.warn('[step] add workspace via native dialog')
  const dir = createTempWorkspaceDir()

  // Mock the native dialog to return our temp directory
  await this.app.evaluate(async ({ dialog }, dirPath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [dirPath],
    })
  }, dir)

  // Click the add button
  const btn = this.page.locator('[data-testid="add-workspace-btn"]')
  await btn.click()

  // Wait for workspace to appear
  await this.page.waitForSelector('[data-testid^="workspace-group-"]', { timeout: 5000 })
})

Then('工作区列表中应该有 {int} 个工作区', async function (this: CradleWorld, count: number) {
  console.warn(`[step] assert workspace count = ${count}`)
  const groups = this.page.locator('[data-testid^="workspace-group-"]')
  await expect(groups).toHaveCount(count)
})

Given('我已添加了一个工作区', async function (this: CradleWorld) {
  console.warn('[step] setup: add one workspace')
  const dir = createTempWorkspaceDir()

  await this.app.evaluate(async ({ dialog }, dirPath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [dirPath],
    })
  }, dir)

  const btn = this.page.locator('[data-testid="add-workspace-btn"]')
  await btn.click()
  await this.page.waitForSelector('[data-testid^="workspace-group-"]', { timeout: 5000 })
})

When('我打开该工作区的菜单', async function (this: CradleWorld) {
  console.warn('[step] open workspace context menu')
  const group = this.page.locator('[data-testid^="workspace-group-"]').first()
  // Hover to reveal the menu trigger
  await group.hover()
  // The trigger is a Button inside the group header
  const menuTrigger = group.locator('[data-slot="menu-trigger"]')
  await menuTrigger.click()
  // Wait for the menu popup to be visible before proceeding
  await this.page.waitForSelector('[data-slot="menu-popup"]', { state: 'visible', timeout: 5000 })
})

When('我点击"移除工作区"', async function (this: CradleWorld) {
  console.warn('[step] click remove workspace')
  // The menu item with destructive variant containing "移除工作区"
  const removeItem = this.page.locator('[data-slot="menu-item"][data-variant="destructive"]')
  await expect(removeItem).toBeVisible({ timeout: 5000 })
  await removeItem.click()

  // Wait for the workspace group to disappear
  await expect(this.page.locator('[data-testid^="workspace-group-"]')).toHaveCount(0, { timeout: 10000 })
})
