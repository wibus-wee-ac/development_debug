// Input: Cucumber tab-management steps, Playwright assertions, and CradleWorld scenario state storage
// Output: Tab management step definitions with deterministic count deltas and active-state assertions
// Position: E2E step layer covering tab-management.feature interactions without sleep-based waits

import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world.ts'

const TAB_BAR = '[data-testid="tab-bar"]'
const TAB_PILL = '[data-testid^="tab-pill-"]'
const TAB_NEW_BUTTON = '[data-testid="tab-new-btn"]'

async function waitForTabBar(world: CradleWorld) {
  await expect(world.page.locator(TAB_BAR)).toBeVisible({ timeout: 15_000 })
}

async function getTabCount(world: CradleWorld): Promise<number> {
  return world.page.locator(TAB_PILL).count()
}

async function waitForTabCount(world: CradleWorld, count: number): Promise<void> {
  await expect(world.page.locator(TAB_PILL)).toHaveCount(count, { timeout: 10_000 })
}

async function ensureMinimumTabCount(world: CradleWorld, minCount: number): Promise<void> {
  const deadline = Date.now() + 10_000

  while (Date.now() < deadline) {
    const currentCount = await getTabCount(world)
    if (currentCount >= minCount) {
      return
    }

    await openNewTab(world)
    await world.page.waitForTimeout(150)
  }

  throw new Error(`Expected at least ${minCount} tabs before continuing`)
}

async function openNewTab(world: CradleWorld): Promise<void> {
  const before = await getTabCount(world)
  const button = world.page.locator(TAB_NEW_BUTTON)
  await expect(button).toBeVisible({ timeout: 10_000 })
  await button.click()
  await waitForTabCount(world, before + 1)
}

async function closeTabAtIndex(world: CradleWorld, index: number): Promise<void> {
  const before = await getTabCount(world)
  const tab = world.page.locator(TAB_PILL).nth(index)
  await expect(tab).toBeVisible({ timeout: 10_000 })
  await tab.hover()

  const closeButton = tab.locator('[data-testid^="tab-close-"]')
  await expect(closeButton).toBeVisible({ timeout: 10_000 })
  await closeButton.click()
  await waitForTabCount(world, before - 1)
}

Then('标签栏应该可见', async function (this: CradleWorld) {
  await waitForTabBar(this)
})

Then('至少有一个标签页存在', async function (this: CradleWorld) {
  await waitForTabBar(this)
  expect(await getTabCount(this)).toBeGreaterThanOrEqual(1)
})

Given('我已打开两个标签页', async function (this: CradleWorld) {
  await waitForTabBar(this)
  await ensureMinimumTabCount(this, 2)
  expect(await getTabCount(this)).toBeGreaterThanOrEqual(2)
})

Given('我已打开三个标签页', async function (this: CradleWorld) {
  await waitForTabBar(this)
  while (await getTabCount(this) < 3) {
    await openNewTab(this)
  }
  expect(await getTabCount(this)).toBeGreaterThanOrEqual(3)
})

Given('第三个标签页处于活跃状态', async function (this: CradleWorld) {
  await expect(this.page.locator(TAB_PILL).nth(2)).toHaveAttribute('data-tab-active', 'true', { timeout: 10_000 })
})

Given('只有一个标签页', async function (this: CradleWorld) {
  await waitForTabBar(this)
  while (await getTabCount(this) > 1) {
    await closeTabAtIndex(this, (await getTabCount(this)) - 1)
  }
  await waitForTabCount(this, 1)
})

When('我点击第一个标签页', async function (this: CradleWorld) {
  const firstTab = this.page.locator(TAB_PILL).first()
  await expect(firstTab).toBeVisible({ timeout: 10_000 })
  await firstTab.click()
  await expect(firstTab).toHaveAttribute('data-tab-active', 'true', { timeout: 10_000 })
})

Then('第一个标签页应处于活跃状态', async function (this: CradleWorld) {
  await expect(this.page.locator(TAB_PILL).first()).toHaveAttribute('data-tab-active', 'true', { timeout: 10_000 })
})

When('我关闭第二个标签页', async function (this: CradleWorld) {
  await ensureMinimumTabCount(this, 2)
  const before = await getTabCount(this)
  this.remember('tabCountBeforeClose', before)
  await closeTabAtIndex(this, 1)
})

Then('标签页总数应减少一个', async function (this: CradleWorld) {
  const before = this.recall<number>('tabCountBeforeClose')
  await waitForTabCount(this, before - 1)
})

Then('该标签页不应显示关闭按钮', async function (this: CradleWorld) {
  const firstTab = this.page.locator(TAB_PILL).first()
  await expect(firstTab).toBeVisible({ timeout: 10_000 })
  await firstTab.hover()
  await expect(firstTab.locator('[data-testid^="tab-close-"]')).toHaveCount(0)
})

When('我关闭第三个标签页', async function (this: CradleWorld) {
  await closeTabAtIndex(this, 2)
})

Then('第二个标签页应处于活跃状态', async function (this: CradleWorld) {
  await expect(this.page.locator(TAB_PILL).nth(1)).toHaveAttribute('data-tab-active', 'true', { timeout: 10_000 })
})

When('我点击新建标签按钮', async function (this: CradleWorld) {
  await waitForTabBar(this)
  const before = await getTabCount(this)
  this.remember('tabCountBeforeCreate', before)
  await openNewTab(this)
})

Then('标签页总数应增加一个', async function (this: CradleWorld) {
  const before = this.recall<number>('tabCountBeforeCreate')
  await waitForTabCount(this, before + 1)
})

Then('新创建的标签页应处于活跃状态', async function (this: CradleWorld) {
  const tabs = this.page.locator(TAB_PILL)
  const lastIndex = (await tabs.count()) - 1
  await expect(tabs.nth(lastIndex)).toHaveAttribute('data-tab-active', 'true', { timeout: 10_000 })
})

When('我切换到第二个标签页', async function (this: CradleWorld) {
  await ensureMinimumTabCount(this, 2)
  const secondTab = this.page.locator(TAB_PILL).nth(1)
  await expect(secondTab).toBeVisible({ timeout: 10_000 })
  await secondTab.click()
  await expect(secondTab).toHaveAttribute('data-tab-active', 'true', { timeout: 10_000 })
})

When('我切换回第一个标签页', async function (this: CradleWorld) {
  const firstTab = this.page.locator(TAB_PILL).first()
  await expect(firstTab).toBeVisible({ timeout: 10_000 })
  await firstTab.click()
  await expect(firstTab).toHaveAttribute('data-tab-active', 'true', { timeout: 10_000 })
})

Then('第一个标签页的内容应完整保留', async function (this: CradleWorld) {
  const firstTab = this.page.locator(TAB_PILL).first()
  await expect(firstTab).toHaveAttribute('data-tab-active', 'true', { timeout: 10_000 })
  await expect(this.page.locator('[data-testid="tab-content-renderer"]')).toBeVisible({ timeout: 10_000 })
  const firstTabTestId = await firstTab.getAttribute('data-testid')
  const firstTabId = firstTabTestId?.replace('tab-pill-', '')
  if (!firstTabId) {
    throw new Error('Missing first tab id when verifying preserved content')
  }
  await expect(this.page.locator(`[data-testid="tab-content-${firstTabId}"]`)).toBeVisible({ timeout: 10_000 })
})
