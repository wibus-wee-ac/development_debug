// Input: Cucumber step bindings, Playwright locators, and CradleWorld scenario state helpers
// Output: Kanban CRUD step definitions with deterministic waits for board, issue, and comment workflows
// Position: E2E step layer covering board and issue management scenarios in kanban.feature

import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world.ts'

const KANBAN_SIDEBAR = '[data-testid="kanban-sidebar"]'
const KANBAN_BOARD = '[data-testid="kanban-board"]'
const KANBAN_BOARD_INPUT = '[data-testid="kanban-new-board-input"]'
const KANBAN_COLUMN = '[data-kanban-column-id]'
const KANBAN_COLUMN_ADD = '[data-testid^="kanban-column-add-"]'
const KANBAN_ISSUE_CARD = '[data-testid^="issue-card-"]'
const KANBAN_ISSUE_INPUT = '[data-testid="kanban-new-issue-input"]'
const KANBAN_CREATE_ISSUE_BUTTON = '[data-testid="kanban-create-issue-btn"]'
const ISSUE_DETAIL_PANEL = '[data-testid="issue-detail-panel"]'
const ISSUE_COMMENT_INPUT = '[data-testid="issue-comment-input"]'
const ISSUE_COMMENT_SUBMIT = '[data-testid="issue-comment-submit"]'
const STATUS_NAME_INPUT = '[data-testid="status-name-input"]'

async function openKanbanPage(world: CradleWorld): Promise<void> {
  const navButton = world.page.locator('[data-testid="nav-kanban"]')
  await expect(navButton).toBeVisible({ timeout: 15_000 })
  await navButton.click()
  await expect(world.page.locator(KANBAN_SIDEBAR)).toBeVisible({ timeout: 10_000 })
}

async function createBoard(world: CradleWorld, name: string): Promise<void> {
  const addButton = world.page.locator('[data-testid="kanban-add-board-btn"]')
  await expect(addButton).toBeVisible({ timeout: 10_000 })
  await addButton.click()

  const input = world.page.locator(KANBAN_BOARD_INPUT)
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(name)
  await input.press('Enter')

  await expect(world.page.locator(KANBAN_SIDEBAR).locator(`text=${name}`)).toBeVisible({ timeout: 10_000 })
  await expect(world.page.locator(KANBAN_BOARD)).toBeVisible({ timeout: 10_000 })
}

async function addStatus(world: CradleWorld, name: string): Promise<void> {
  const input = world.page.locator(STATUS_NAME_INPUT)
  await expect(input).toBeVisible({ timeout: 10_000 })
  const columns = world.page.locator(KANBAN_COLUMN)
  const columnCountBefore = await columns.count()
  await input.fill(name)
  await input.press('Enter')
  await expect(columns).toHaveCount(columnCountBefore + 1, { timeout: 10_000 })
  await expect(columns.filter({ hasText: name }).first()).toBeVisible({ timeout: 10_000 })
}

async function ensureDefaultStatuses(world: CradleWorld): Promise<void> {
  const settingsButton = world.page.locator('[data-testid="kanban-settings-btn"]')
  await expect(settingsButton).toBeVisible({ timeout: 10_000 })
  await settingsButton.click()

  await addStatus(world, 'To Do')
  await addStatus(world, 'In Progress')

  await world.page.locator(KANBAN_BOARD).click({ position: { x: 10, y: 10 } })
  await expect(world.page.locator(KANBAN_COLUMN)).toHaveCount(2, { timeout: 10_000 })
}

async function createBoardWithDefaultStatuses(world: CradleWorld, name = 'E2E Board'): Promise<void> {
  await openKanbanPage(world)
  await createBoard(world, name)
  await ensureDefaultStatuses(world)
}

async function createIssueInFirstColumn(world: CradleWorld, title: string): Promise<void> {
  const firstColumn = world.page.locator(KANBAN_COLUMN).first()
  await expect(firstColumn).toBeVisible({ timeout: 10_000 })
  await firstColumn.hover()

  const addButton = world.page.locator(KANBAN_COLUMN_ADD).first()
  await expect(addButton).toBeVisible({ timeout: 10_000 })
  await addButton.click({ force: true })

  const input = world.page.locator(KANBAN_ISSUE_INPUT)
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(title)

  const createButton = world.page.locator(KANBAN_CREATE_ISSUE_BUTTON)
  await expect(createButton).toBeEnabled({ timeout: 10_000 })
  await createButton.click()

  await expect(world.page.locator(KANBAN_ISSUE_CARD).filter({ hasText: title })).toBeVisible({ timeout: 10_000 })
}

async function openIssueDetail(world: CradleWorld, title: string): Promise<void> {
  const card = world.page.locator(KANBAN_ISSUE_CARD).filter({ hasText: title })
  await expect(card).toBeVisible({ timeout: 10_000 })
  await card.click()
  await expect(world.page.locator(ISSUE_DETAIL_PANEL)).toBeVisible({ timeout: 10_000 })
}

Then('我应该看到看板侧栏', async function (this: CradleWorld) {
  await expect(this.page.locator(KANBAN_SIDEBAR)).toBeVisible({ timeout: 10_000 })
})

Then('看板页面应提示{string}', async function (this: CradleWorld, text: string) {
  await expect(this.page.locator(`text=${text}`)).toBeVisible({ timeout: 10_000 })
})

When('我点击看板导航按钮', async function (this: CradleWorld) {
  await openKanbanPage(this)
})

Given('我已导航到看板页面', async function (this: CradleWorld) {
  await openKanbanPage(this)
})

When('我点击新建看板按钮', async function (this: CradleWorld) {
  const addButton = this.page.locator('[data-testid="kanban-add-board-btn"]')
  await expect(addButton).toBeVisible({ timeout: 10_000 })
  await addButton.click()
  await expect(this.page.locator(KANBAN_BOARD_INPUT)).toBeVisible({ timeout: 10_000 })
})

When('我输入看板名称{string}并回车', async function (this: CradleWorld, name: string) {
  const input = this.page.locator(KANBAN_BOARD_INPUT)
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(name)
  await input.press('Enter')
})

Given('我已创建了一个看板', async function (this: CradleWorld) {
  await createBoardWithDefaultStatuses(this)
})

Then('看板侧栏应显示名为{string}的看板', async function (this: CradleWorld, name: string) {
  await expect(this.page.locator(KANBAN_SIDEBAR).locator(`text=${name}`)).toBeVisible({ timeout: 10_000 })
})

Then('看板视图应显示', async function (this: CradleWorld) {
  await expect(this.page.locator(KANBAN_BOARD)).toBeVisible({ timeout: 10_000 })
})

When('我点击第一个列的添加按钮', async function (this: CradleWorld) {
  const firstColumn = this.page.locator(KANBAN_COLUMN).first()
  await expect(firstColumn).toBeVisible({ timeout: 10_000 })
  await firstColumn.hover()

  const addButton = this.page.locator(KANBAN_COLUMN_ADD).first()
  await expect(addButton).toBeVisible({ timeout: 10_000 })
  await addButton.click({ force: true })
  await expect(this.page.locator(KANBAN_ISSUE_INPUT)).toBeVisible({ timeout: 10_000 })
})

When('我输入 Issue 标题{string}并回车', async function (this: CradleWorld, title: string) {
  const input = this.page.locator(KANBAN_ISSUE_INPUT)
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(title)

  const createButton = this.page.locator(KANBAN_CREATE_ISSUE_BUTTON)
  await expect(createButton).toBeEnabled({ timeout: 10_000 })
  await createButton.click()
})

Then('该列应显示一张名为{string}的卡片', async function (this: CradleWorld, title: string) {
  await expect(this.page.locator(KANBAN_ISSUE_CARD).filter({ hasText: title })).toBeVisible({ timeout: 10_000 })
})

Given('我已在第一列创建了一个 Issue{string}', async function (this: CradleWorld, title: string) {
  await createIssueInFirstColumn(this, title)
})

When('我点击名为{string}的 Issue 卡片', async function (this: CradleWorld, title: string) {
  await openIssueDetail(this, title)
})

Given('我已打开该 Issue 的详情面板', async function (this: CradleWorld) {
  const firstCard = this.page.locator(KANBAN_ISSUE_CARD).first()
  await expect(firstCard).toBeVisible({ timeout: 10_000 })
  await firstCard.click()
  await expect(this.page.locator(ISSUE_DETAIL_PANEL)).toBeVisible({ timeout: 10_000 })
})

Given('我已打开名为{string}的 Issue 详情面板', async function (this: CradleWorld, title: string) {
  await openIssueDetail(this, title)
})

Then('Issue 详情面板应显示', async function (this: CradleWorld) {
  await expect(this.page.locator(ISSUE_DETAIL_PANEL)).toBeVisible({ timeout: 10_000 })
})

Then('面板标题应为{string}', async function (this: CradleWorld, title: string) {
  await expect(this.page.locator(ISSUE_DETAIL_PANEL).locator(`text=${title}`)).toBeVisible({ timeout: 10_000 })
})

When('我在评论框中输入{string}', async function (this: CradleWorld, text: string) {
  const textarea = this.page.locator(ISSUE_COMMENT_INPUT)
  await expect(textarea).toBeVisible({ timeout: 10_000 })
  await textarea.fill(text)
})

When('我点击Comment按钮', async function (this: CradleWorld) {
  const comments = this.page.locator('[data-testid^="comment-"]')
  this.remember('issueCommentCountBeforeSubmit', await comments.count())

  const submitButton = this.page.locator(ISSUE_COMMENT_SUBMIT)
  await expect(submitButton).toBeEnabled({ timeout: 10_000 })
  await submitButton.click()

  await expect(this.page.locator(ISSUE_COMMENT_INPUT)).toHaveValue('', { timeout: 10_000 })
})

Then('评论列表应显示{string}', async function (this: CradleWorld, text: string) {
  const comment = this.page.locator('[data-testid^="comment-"]').filter({ hasText: text })
  await expect(comment).toBeVisible({ timeout: 10_000 })

  const before = this.maybeRecall<number>('issueCommentCountBeforeSubmit')
  if (typeof before === 'number') {
    await expect(this.page.locator('[data-testid^="comment-"]')).toHaveCount(before + 1, { timeout: 10_000 })
  }
})
