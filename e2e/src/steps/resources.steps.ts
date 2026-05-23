import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world'

const RESOURCES_TIMEOUT = 15_000

function resourcesPopover(world: CradleWorld) {
  return world.page.locator('[data-testid="resources-popover"]')
}

async function openResourcesPopover(world: CradleWorld): Promise<void> {
  const trigger = world.page.getByRole('button', { name: /Resources:/ })

  await expect(trigger).toBeVisible({ timeout: RESOURCES_TIMEOUT })
  await trigger.click()
  await expect(resourcesPopover(world)).toBeVisible({ timeout: RESOURCES_TIMEOUT })
}

When('我打开资源诊断弹层', async function (this: CradleWorld) {
  console.warn('[step] open resources popover')
  await openResourcesPopover(this)
})

When('我刷新资源诊断弹层', async function (this: CradleWorld) {
  console.warn('[step] refresh resources popover')
  const popover = resourcesPopover(this)
  const refreshButton = popover.getByRole('button', { name: 'Refresh resources' })

  await expect(popover).toBeVisible({ timeout: RESOURCES_TIMEOUT })
  await expect(refreshButton).toBeVisible({ timeout: RESOURCES_TIMEOUT })
  await refreshButton.click()
})

Then('资源诊断弹层应显示核心资源分组', async function (this: CradleWorld) {
  console.warn('[step] assert resources popover groups')
  const popover = resourcesPopover(this)

  await expect(popover).toBeVisible({ timeout: RESOURCES_TIMEOUT })
  await expect(popover).toContainText('Resources', { timeout: RESOURCES_TIMEOUT })
  await expect(popover).toContainText('Memory', { timeout: RESOURCES_TIMEOUT })
  await expect(popover).toContainText('CPU', { timeout: RESOURCES_TIMEOUT })
  await expect(popover).toContainText('Renderer', { timeout: RESOURCES_TIMEOUT })
  await expect(popover).toContainText('Server', { timeout: RESOURCES_TIMEOUT })
  await expect(popover).toContainText('Chronicle', { timeout: RESOURCES_TIMEOUT })
  await expect(popover).toContainText('CLI TUI', { timeout: RESOURCES_TIMEOUT })
  await expect(popover).toContainText('Bottom Panel', { timeout: RESOURCES_TIMEOUT })
  await expect(popover.getByRole('button', { name: 'Refresh resources' })).toBeVisible({ timeout: RESOURCES_TIMEOUT })
})
