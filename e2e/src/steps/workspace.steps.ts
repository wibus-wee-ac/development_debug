// Input: Cucumber workspace steps, Playwright assertions, and CradleWorld temp-directory helpers
// Output: Workspace management step definitions with isolated temp directories and deterministic dialog stubbing
// Position: E2E step layer covering workspace.feature setup and teardown workflows

import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world'

async function mockWorkspaceDialog(world: CradleWorld, dirPath: string): Promise<void> {
  await world.app.evaluate(async ({ dialog }, targetPath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [targetPath],
    })
  }, dirPath)
}

Then('我应该看到工作区列表为空', async function (this: CradleWorld) {
  console.warn('[step] assert workspace list is empty')
  await expect(this.page.locator('[data-testid="workspace-list"]')).toBeVisible({ timeout: 15_000 })
  await expect(this.page.locator('[data-testid="add-workspace-empty-btn"]')).toBeVisible({ timeout: 15_000 })
})

Then('我应该看到"添加工作区"按钮', async function (this: CradleWorld) {
  await expect(this.page.locator('[data-testid="add-workspace-btn"]')).toBeVisible({ timeout: 15_000 })
})

When('我通过原生对话框添加工作区', async function (this: CradleWorld) {
  const dir = this.createTempWorkspaceDir()
  await mockWorkspaceDialog(this, dir)

  const button = this.page.locator('[data-testid="add-workspace-btn"]')
  await expect(button).toBeVisible({ timeout: 10_000 })
  await button.click()
  await expect(this.page.locator('[data-testid^="workspace-group-"]')).toHaveCount(1, { timeout: 10_000 })
})

Then('工作区列表中应该有 {int} 个工作区', async function (this: CradleWorld, count: number) {
  await expect(this.page.locator('[data-testid^="workspace-group-"]')).toHaveCount(count, { timeout: 10_000 })
})

Given('我已添加了一个工作区', async function (this: CradleWorld) {
  console.warn('[step] setup: add one workspace')
  const dir = this.createTempWorkspaceDir()
  await mockWorkspaceDialog(this, dir)

  const button = this.page.locator('[data-testid="add-workspace-btn"]')
  await expect(button).toBeVisible({ timeout: 10_000 })
  await button.click()
  await expect(this.page.locator('[data-testid^="workspace-group-"]')).toHaveCount(1, { timeout: 10_000 })
})

When('我打开该工作区的菜单', async function (this: CradleWorld) {
  const group = this.page.locator('[data-testid^="workspace-group-"]').first()
  await expect(group).toBeVisible({ timeout: 10_000 })
  await group.hover()

  const menuTrigger = group.locator('[data-slot="menu-trigger"]')
  await expect(menuTrigger).toBeVisible({ timeout: 10_000 })
  await menuTrigger.click()
  await expect(this.page.locator('[data-slot="menu-popup"]')).toBeVisible({ timeout: 10_000 })
})

When('我点击"移除工作区"', async function (this: CradleWorld) {
  const removeItem = this.page.locator('[data-slot="menu-item"][data-variant="destructive"]')
  await expect(removeItem).toBeVisible({ timeout: 10_000 })
  await removeItem.click()
  await expect(this.page.locator('[data-testid^="workspace-group-"]')).toHaveCount(0, { timeout: 10_000 })
})
