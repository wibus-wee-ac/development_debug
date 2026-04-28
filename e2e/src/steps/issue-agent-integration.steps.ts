import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world.ts'

// ── Navigation ────────────────────────────────────────────────────────────────

When('我点击看板导航按钮', async function (this: CradleWorld) {
  console.warn('[step] click kanban nav button')
  const btn = this.page.locator('[data-testid="nav-kanban"]')
  await expect(btn).toBeVisible({ timeout: 15000 })
  await btn.click()
  await this.page.waitForSelector('[data-testid="kanban-sidebar"]', { timeout: 5000 })
})

Given('我已导航到看板页面', async function (this: CradleWorld) {
  console.warn('[step] navigate to kanban')
  const btn = this.page.locator('[data-testid="nav-kanban"]')
  await expect(btn).toBeVisible({ timeout: 15000 })
  await btn.click()
  await this.page.waitForSelector('[data-testid="kanban-sidebar"]', { timeout: 5000 })
})

Then('我应该看到看板侧栏', async function (this: CradleWorld) {
  console.warn('[step] assert kanban sidebar visible')
  const sidebar = this.page.locator('[data-testid="kanban-sidebar"]')
  await expect(sidebar).toBeVisible({ timeout: 5000 })
})

Then('看板侧栏应提示{string}', async function (this: CradleWorld, text: string) {
  console.warn(`[step] assert kanban placeholder text: ${text}`)
  const placeholder = this.page.locator(`text=${text}`)
  await expect(placeholder).toBeVisible({ timeout: 5000 })
})

// ── Board creation ────────────────────────────────────────────────────────────

When('我点击新建看板按钮', async function (this: CradleWorld) {
  console.warn('[step] click create board button')
  const sidebar = this.page.locator('[data-testid="kanban-sidebar"]')
  const addBtn = sidebar.locator('[data-testid="kanban-add-board-btn"]')
  await addBtn.click()
  await this.page.waitForSelector('[data-testid="kanban-new-board-input"]', { timeout: 3000 })
})

When('我输入看板名称{string}并回车', async function (this: CradleWorld, name: string) {
  console.warn(`[step] type board name: ${name}`)
  const input = this.page.locator('[data-testid="kanban-new-board-input"]')
  await expect(input).toBeVisible()
  await input.fill(name)
  await input.press('Enter')
  // Wait for board to appear
  await this.page.waitForTimeout(500)
})

Given('我已创建了一个看板', async function (this: CradleWorld) {
  console.warn('[step] setup: navigate to kanban and create a board')
  // Navigate to kanban
  const navBtn = this.page.locator('[data-testid="nav-kanban"]')
  await expect(navBtn).toBeVisible({ timeout: 15000 })
  await navBtn.click()
  await this.page.waitForSelector('[data-testid="kanban-sidebar"]', { timeout: 5000 })

  // Click the add button in sidebar header
  const sidebar = this.page.locator('[data-testid="kanban-sidebar"]')
  const addBtn = sidebar.locator('[data-testid="kanban-add-board-btn"]')
  await addBtn.click()

  const input = this.page.locator('[data-testid="kanban-new-board-input"]')
  await expect(input).toBeVisible({ timeout: 3000 })
  await input.fill('E2E Board')
  await input.press('Enter')

  // Wait for board view to load
  await this.page.waitForSelector('[data-testid="kanban-board"]', { timeout: 5000 })

  // Open settings popover and create default statuses
  const settingsBtn = this.page.locator('[data-testid="kanban-settings-btn"]')
  await expect(settingsBtn).toBeVisible({ timeout: 3000 })
  await settingsBtn.click()

  const statusInput = this.page.locator('[data-testid="status-name-input"]')
  await expect(statusInput).toBeVisible({ timeout: 3000 })

  // Create "To Do" status
  await statusInput.fill('To Do')
  await statusInput.press('Enter')
  await this.page.waitForTimeout(300)

  // Create "In Progress" status
  await statusInput.fill('In Progress')
  await statusInput.press('Enter')
  await this.page.waitForTimeout(300)

  // Close the popover by clicking outside
  await this.page.locator('[data-testid="kanban-board"]').click({ position: { x: 10, y: 10 } })
  await this.page.waitForTimeout(300)

  // Wait for columns to appear
  await expect(this.page.locator('[data-testid^="kanban-column-"]').first()).toBeVisible({ timeout: 5000 })
})

Then('看板侧栏应显示名为{string}的看板', async function (this: CradleWorld, name: string) {
  console.warn(`[step] assert board "${name}" in sidebar`)
  const sidebar = this.page.locator('[data-testid="kanban-sidebar"]')
  await expect(sidebar.locator(`text=${name}`)).toBeVisible({ timeout: 5000 })
})

Then('看板视图应显示', async function (this: CradleWorld) {
  console.warn('[step] assert board view visible')
  const board = this.page.locator('[data-testid="kanban-board"]')
  await expect(board).toBeVisible({ timeout: 5000 })
})

// ── Issue creation ────────────────────────────────────────────────────────────

When('我点击第一个列的添加按钮', async function (this: CradleWorld) {
  console.warn('[step] click first column add button')
  // Hover on column first to reveal the add button (it has opacity-0 by default)
  const column = this.page.locator('[data-testid^="kanban-column-"]').first()
  await expect(column).toBeVisible({ timeout: 5000 })
  await column.hover()
  const addBtn = this.page.locator('[data-testid^="kanban-column-add-"]').first()
  await addBtn.click({ force: true })
  await this.page.waitForSelector('[data-testid="kanban-new-issue-input"]', { timeout: 3000 })
})

When('我输入 Issue 标题{string}并回车', async function (this: CradleWorld, title: string) {
  console.warn(`[step] type issue title: ${title}`)
  const input = this.page.locator('[data-testid="kanban-new-issue-input"]')
  await expect(input).toBeVisible()
  await input.fill(title)
  // Click "Create issue" button (Enter alone does nothing, need ⌘+Enter or button click)
  const createBtn = this.page.locator('[data-testid="kanban-create-issue-btn"]')
  await expect(createBtn).toBeEnabled({ timeout: 3000 })
  await createBtn.click()
  await this.page.waitForTimeout(500)
})

Then('该列应显示一张名为{string}的卡片', async function (this: CradleWorld, title: string) {
  console.warn(`[step] assert issue card "${title}" visible`)
  const card = this.page.locator('[data-testid^="issue-card-"]').filter({ hasText: title })
  await expect(card).toBeVisible({ timeout: 5000 })
})

Given('我已在第一列创建了一个 Issue{string}', async function (this: CradleWorld, title: string) {
  console.warn(`[step] setup: create issue "${title}" in first column`)
  const column = this.page.locator('[data-testid^="kanban-column-"]').first()
  await column.hover()
  const addBtn = this.page.locator('[data-testid^="kanban-column-add-"]').first()
  await addBtn.click({ force: true })

  const input = this.page.locator('[data-testid="kanban-new-issue-input"]')
  await expect(input).toBeVisible({ timeout: 3000 })
  await input.fill(title)
  // Click "Create issue" button
  const createBtn = this.page.locator('[data-testid="kanban-create-issue-btn"]')
  await expect(createBtn).toBeEnabled({ timeout: 3000 })
  await createBtn.click()
  await this.page.waitForTimeout(500)
})

// ── Issue detail ──────────────────────────────────────────────────────────────

When('我点击名为{string}的 Issue 卡片', async function (this: CradleWorld, title: string) {
  console.warn(`[step] click issue card "${title}"`)
  const card = this.page.locator('[data-testid^="issue-card-"]').filter({ hasText: title })
  await expect(card).toBeVisible({ timeout: 5000 })
  await card.click()
})

Given('我已打开该 Issue 的详情面板', async function (this: CradleWorld) {
  console.warn('[step] setup: open issue detail panel')
  const card = this.page.locator('[data-testid^="issue-card-"]').first()
  await expect(card).toBeVisible({ timeout: 5000 })
  await card.click()
  await this.page.waitForSelector('[data-testid="issue-detail-panel"]', { timeout: 5000 })
})

Then('Issue 详情面板应显示', async function (this: CradleWorld) {
  console.warn('[step] assert issue detail panel visible')
  const panel = this.page.locator('[data-testid="issue-detail-panel"]')
  await expect(panel).toBeVisible({ timeout: 5000 })
})

Then('面板标题应为{string}', async function (this: CradleWorld, title: string) {
  console.warn(`[step] assert panel title is "${title}"`)
  const panel = this.page.locator('[data-testid="issue-detail-panel"]')
  await expect(panel.locator(`text=${title}`)).toBeVisible({ timeout: 5000 })
})

// ── Comments ──────────────────────────────────────────────────────────────────

When('我在评论框中输入{string}', async function (this: CradleWorld, text: string) {
  console.warn(`[step] type comment: ${text}`)
  const textarea = this.page.locator('[data-testid="issue-comment-input"]')
  await expect(textarea).toBeVisible({ timeout: 5000 })
  await textarea.fill(text)
})

When('我点击Comment按钮', async function (this: CradleWorld) {
  console.warn('[step] click comment submit button')
  const btn = this.page.locator('[data-testid="issue-comment-submit"]')
  await expect(btn).toBeEnabled({ timeout: 3000 })
  await btn.click()
  await this.page.waitForTimeout(500)
})

Then('评论列表应显示{string}', async function (this: CradleWorld, text: string) {
  console.warn(`[step] assert comment "${text}" visible`)
  const comment = this.page.locator('[data-testid^="comment-"]').filter({ hasText: text })
  await expect(comment).toBeVisible({ timeout: 5000 })
})
