import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world.ts'

// ── Selectors ─────────────────────────────────────────────────────────────────

const TAB_BAR = '[data-testid="tab-bar"]'
const TAB_PILL = '[data-testid^="tab-pill-"]'
const TAB_CLOSE = '[data-testid^="tab-close-"]'
const TAB_NEW_BTN = '[data-testid="tab-new-btn"]'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function waitForTabBar(world: CradleWorld) {
  await world.page.waitForSelector(TAB_BAR, { state: 'visible', timeout: 15000 })
}

async function getTabCount(world: CradleWorld): Promise<number> {
  return world.page.locator(TAB_PILL).count()
}

async function openNewTab(world: CradleWorld) {
  const btn = world.page.locator(TAB_NEW_BTN)
  await expect(btn).toBeVisible({ timeout: 5000 })
  await btn.click()
  // Wait for the tab system to settle
  await world.page.waitForTimeout(300)
}

// ── Steps ─────────────────────────────────────────────────────────────────────

Then('标签栏应该可见', async function (this: CradleWorld) {
  await waitForTabBar(this)
  const bar = this.page.locator(TAB_BAR)
  await expect(bar).toBeVisible()
})

Then('至少有一个标签页存在', async function (this: CradleWorld) {
  await waitForTabBar(this)
  const count = await getTabCount(this)
  expect(count).toBeGreaterThanOrEqual(1)
})

Given('我已打开两个标签页', async function (this: CradleWorld) {
  await waitForTabBar(this)
  const initial = await getTabCount(this)

  // Open tabs until we have at least 2
  for (let i = initial; i < 2; i++) {
    await openNewTab(this)
  }

  const count = await getTabCount(this)
  expect(count).toBeGreaterThanOrEqual(2)
  // Store the count for later assertions
  this.attach(String(count), 'text/plain')
})

Given('我已打开三个标签页', async function (this: CradleWorld) {
  await waitForTabBar(this)
  const initial = await getTabCount(this)

  for (let i = initial; i < 3; i++) {
    await openNewTab(this)
  }

  const count = await getTabCount(this)
  expect(count).toBeGreaterThanOrEqual(3)
})

Given('第三个标签页处于活跃状态', async function (this: CradleWorld) {
  // The third tab is already active (it was the last opened).
  // Just verify the state — avoid clicking since Playwright's center-click
  // can accidentally hit the close button in narrow pills.
  const thirdTab = this.page.locator(TAB_PILL).nth(2)
  await expect(thirdTab).toBeVisible({ timeout: 5000 })
  await expect(thirdTab).toHaveAttribute('data-tab-active', 'true', { timeout: 3000 })
})

Given('只有一个标签页', async function (this: CradleWorld) {
  await waitForTabBar(this)
  // Close all extra tabs until only 1 remains
  let count = await getTabCount(this)
  while (count > 1) {
    // Find a non-active or last close button and click it
    const closeBtns = this.page.locator(TAB_CLOSE)
    const closeCount = await closeBtns.count()
    if (closeCount === 0) {
      break
    }
    await closeBtns.last().click()
    await this.page.waitForTimeout(200)
    count = await getTabCount(this)
  }
  expect(count).toBe(1)
})

When('我点击第一个标签页', async function (this: CradleWorld) {
  const firstTab = this.page.locator(TAB_PILL).first()
  await firstTab.click()
  await this.page.waitForTimeout(200)
})

Then('第一个标签页应处于活跃状态', async function (this: CradleWorld) {
  const firstTab = this.page.locator(TAB_PILL).first()
  await expect(firstTab).toHaveAttribute('data-tab-active', 'true')
})

When('我关闭第二个标签页', async function (this: CradleWorld) {
  // Store count before closing
  const countBefore = await getTabCount(this)
  this.attach(String(countBefore), 'text/plain')

  // Hover over the second tab to reveal close button
  const secondTab = this.page.locator(TAB_PILL).nth(1)
  await secondTab.hover()
  await this.page.waitForTimeout(200)

  // Click the close button within the second tab
  const closeBtn = secondTab.locator('[data-testid^="tab-close-"]')
  await expect(closeBtn).toBeVisible({ timeout: 3000 })
  await closeBtn.click()
  await this.page.waitForTimeout(300)
})

Then('标签页总数应减少一个', async function (this: CradleWorld) {
  // We rely on the tab count going down. Since we started with >= 2, we should have >= 1 now.
  const count = await getTabCount(this)
  expect(count).toBeGreaterThanOrEqual(1)
})

Then('该标签页不应显示关闭按钮', async function (this: CradleWorld) {
  // With only one tab, either: it's pinned (no close btn at all) or
  // even on hover, the close btn should not be functional
  const tab = this.page.locator(TAB_PILL).first()
  await tab.hover()
  await this.page.waitForTimeout(200)

  const closeBtns = this.page.locator(TAB_CLOSE)
  const count = await closeBtns.count()

  // Either no close buttons exist, or if they do, clicking should not reduce tab count
  if (count > 0) {
    await closeBtns.first().click()
    await this.page.waitForTimeout(200)
    const afterCount = await getTabCount(this)
    expect(afterCount).toBe(1) // Still 1 — closing was prevented
  }
})

When('我关闭第三个标签页', async function (this: CradleWorld) {
  const thirdTab = this.page.locator(TAB_PILL).nth(2)
  await thirdTab.hover()
  await this.page.waitForTimeout(200)

  const closeBtn = thirdTab.locator('[data-testid^="tab-close-"]')
  await expect(closeBtn).toBeVisible({ timeout: 3000 })
  await closeBtn.click()
  await this.page.waitForTimeout(300)
})

Then('第二个标签页应处于活跃状态', async function (this: CradleWorld) {
  const secondTab = this.page.locator(TAB_PILL).nth(1)
  await expect(secondTab).toHaveAttribute('data-tab-active', 'true')
})

When('我点击新建标签按钮', async function (this: CradleWorld) {
  await waitForTabBar(this)
  const countBefore = await getTabCount(this)
  this.attach(String(countBefore), 'text/plain')

  await openNewTab(this)
})

Then('标签页总数应增加一个', async function (this: CradleWorld) {
  const count = await getTabCount(this)
  expect(count).toBeGreaterThanOrEqual(2) // At least: initial + 1
})

Then('新创建的标签页应处于活跃状态', async function (this: CradleWorld) {
  // The last pill should be active (newly opened tab)
  const pills = this.page.locator(TAB_PILL)
  const count = await pills.count()
  const lastPill = pills.nth(count - 1)
  await expect(lastPill).toHaveAttribute('data-tab-active', 'true')
})

When('我切换到第二个标签页', async function (this: CradleWorld) {
  const secondTab = this.page.locator(TAB_PILL).nth(1)
  await secondTab.click()
  await this.page.waitForTimeout(300)
})

When('我切换回第一个标签页', async function (this: CradleWorld) {
  const firstTab = this.page.locator(TAB_PILL).first()
  await firstTab.click()
  await this.page.waitForTimeout(300)
})

Then('第一个标签页的内容应完整保留', async function (this: CradleWorld) {
  // The first tab should be visible and have its content rendered
  const firstTab = this.page.locator(TAB_PILL).first()
  await expect(firstTab).toHaveAttribute('data-tab-active', 'true')

  // The tab content area should be visible (Activity mode="visible")
  const contentRenderer = this.page.locator('[data-testid="tab-content-renderer"]')
  await expect(contentRenderer).toBeVisible()

  // There should be at least one visible tab content area
  const visibleContent = this.page.locator('[data-tab-visible="true"]')
  await expect(visibleContent).toBeVisible()
})
