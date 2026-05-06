// Input: Cucumber workspace steps, Playwright assertions, and CradleWorld temp-directory helpers
// Output: Workspace management step definitions with isolated temp directories and deterministic dialog stubbing
// Position: E2E step layer covering workspace.feature setup and teardown workflows

import { writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import { queryDatabaseRow, queryDatabaseRows } from '../support/database'
import type { CradleWorld } from '../support/world'

interface PersistedWorkspaceRow {
  id: string
  name: string
  path: string
  createdAt: number
  updatedAt: number
}

interface WorkspaceFixture {
  id?: string
  dir: string
  name: string
  agentsHeading: string
  agentsBody: string
}

const WORKSPACE_FIXTURES_KEY = 'workspace.fixtures'
const CURRENT_WORKSPACE_ID_KEY = 'workspace.current-id'

async function mockWorkspaceDialog(world: CradleWorld, dirPath: string): Promise<void> {
  await world.app.evaluate(async ({ dialog }, targetPath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [targetPath],
    })
  }, dirPath)
}

function createWorkspaceFixture(world: CradleWorld, prefix: string, label: string): WorkspaceFixture {
  const dir = world.createTempWorkspaceDir(prefix)
  const name = basename(dir)
  const agentsHeading = `${label} Operating Model`
  const agentsBody = `${label} overview content used for end-to-end verification.`

  writeFileSync(join(dir, 'AGENTS.md'), `# ${agentsHeading}\n\n${agentsBody}\n`, 'utf8')

  return {
    dir,
    name,
    agentsHeading,
    agentsBody,
  }
}

function rememberWorkspaceFixtures(world: CradleWorld, fixtures: WorkspaceFixture[]): void {
  world.remember(WORKSPACE_FIXTURES_KEY, fixtures)
}

function recallWorkspaceFixtures(world: CradleWorld): WorkspaceFixture[] {
  return world.recall<WorkspaceFixture[]>(WORKSPACE_FIXTURES_KEY)
}

function setCurrentWorkspace(world: CradleWorld, fixture: WorkspaceFixture): void {
  if (!fixture.id) {
    throw new Error(`Workspace fixture ${fixture.name} has no persisted id`)
  }

  world.remember(CURRENT_WORKSPACE_ID_KEY, fixture.id)
}

function recallCurrentWorkspace(world: CradleWorld): WorkspaceFixture {
  const currentWorkspaceId = world.recall<string>(CURRENT_WORKSPACE_ID_KEY)
  const fixture = recallWorkspaceFixtures(world).find(workspace => workspace.id === currentWorkspaceId)

  if (!fixture) {
    throw new Error(`Missing current workspace fixture for id ${currentWorkspaceId}`)
  }

  return fixture
}

function recallWorkspaceByOrdinal(world: CradleWorld, ordinal: number): WorkspaceFixture {
  const fixture = recallWorkspaceFixtures(world)[ordinal - 1]

  if (!fixture) {
    throw new Error(`Missing workspace fixture at ordinal ${ordinal}`)
  }

  return fixture
}

function updateRememberedWorkspaceName(world: CradleWorld, workspaceId: string, nextName: string): void {
  const fixtures = recallWorkspaceFixtures(world)
  const target = fixtures.find(fixture => fixture.id === workspaceId)

  if (!target) {
    throw new Error(`Missing workspace fixture for rename: ${workspaceId}`)
  }

  target.name = nextName
  rememberWorkspaceFixtures(world, fixtures)
}

async function queryWorkspaceByPath(world: CradleWorld, dirPath: string): Promise<PersistedWorkspaceRow | null> {
  return queryDatabaseRow<PersistedWorkspaceRow>(
    world,
    `
      select
        id,
        name,
        path,
        created_at as createdAt,
        updated_at as updatedAt
      from workspaces
      where path = ?
    `,
    [dirPath],
  )
}

async function addWorkspaceFromPicker(world: CradleWorld, fixture: WorkspaceFixture): Promise<void> {
  await mockWorkspaceDialog(world, fixture.dir)

  const button = world.page.locator('[data-testid="add-workspace-btn"]')
  await expect(button).toBeVisible({ timeout: 10_000 })
  await button.click()

  await expect.poll(async () => {
    const persisted = await queryWorkspaceByPath(world, fixture.dir)
    return persisted?.id ?? null
  }, { timeout: 10_000 }).not.toBeNull()

  const persisted = await queryWorkspaceByPath(world, fixture.dir)

  if (!persisted) {
    throw new Error(`Workspace was not persisted for path ${fixture.dir}`)
  }

  fixture.id = persisted.id
  fixture.name = persisted.name

  await expect(world.page.locator(`[data-testid="workspace-open-${persisted.id}"]`)).toContainText(fixture.name, { timeout: 10_000 })
}

function activeWorkspaceDetailPage(world: CradleWorld) {
  return world.page.locator('[data-testid="workspace-detail-page"]:visible').first()
}

async function openWorkspaceDetail(world: CradleWorld, fixture: WorkspaceFixture): Promise<void> {
  if (!fixture.id) {
    throw new Error(`Workspace fixture ${fixture.name} has not been persisted yet`)
  }

  const button = world.page.locator(`[data-testid="workspace-open-${fixture.id}"]`)
  await expect(button).toBeVisible({ timeout: 10_000 })
  await button.click()

  const detailPage = activeWorkspaceDetailPage(world)
  await expect(detailPage).toBeVisible({ timeout: 10_000 })
  await expect(detailPage.locator('[data-testid="workspace-detail-path"]')).toHaveText(fixture.dir, { timeout: 10_000 })

  setCurrentWorkspace(world, fixture)
}

async function assertWorkspaceDetailContent(world: CradleWorld, fixture: WorkspaceFixture): Promise<void> {
  const detailPage = activeWorkspaceDetailPage(world)
  const agentsSection = detailPage.locator('[data-testid="workspace-detail-agents-section"]')

  await expect(detailPage.locator('[data-testid="workspace-detail-title-trigger"]')).toContainText(fixture.name, { timeout: 10_000 })
  await expect(detailPage.locator('[data-testid="workspace-detail-path"]')).toHaveText(fixture.dir, { timeout: 10_000 })
  await expect(agentsSection).toContainText('AGENTS.md', { timeout: 10_000 })
  await expect(agentsSection).toContainText(fixture.agentsHeading, { timeout: 10_000 })
  await expect(agentsSection).toContainText(fixture.agentsBody, { timeout: 10_000 })
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
  const fixture = {
    dir: this.createTempWorkspaceDir(),
    name: '',
    agentsHeading: 'Added Workspace Operating Model',
    agentsBody: 'Added workspace overview content used for end-to-end verification.',
  }

  rememberWorkspaceFixtures(this, [fixture])
  await addWorkspaceFromPicker(this, fixture)
  setCurrentWorkspace(this, fixture)
  await expect(this.page.locator('[data-testid^="workspace-group-"]')).toHaveCount(1, { timeout: 10_000 })
})

Then('工作区列表中应该有 {int} 个工作区', async function (this: CradleWorld, count: number) {
  await expect(this.page.locator('[data-testid^="workspace-group-"]')).toHaveCount(count, { timeout: 10_000 })
})

Given('我已添加了一个工作区', async function (this: CradleWorld) {
  console.warn('[step] setup: add one workspace')
  const fixture = {
    dir: this.createTempWorkspaceDir(),
    name: '',
    agentsHeading: 'Single Workspace Operating Model',
    agentsBody: 'Single workspace overview content used for end-to-end verification.',
  }

  rememberWorkspaceFixtures(this, [fixture])
  await addWorkspaceFromPicker(this, fixture)
  setCurrentWorkspace(this, fixture)
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
})

Given('我已添加了一个包含 AGENTS.md 的工作区', async function (this: CradleWorld) {
  const fixture = createWorkspaceFixture(this, 'cradle-e2e-detail-', 'Workspace Detail')

  rememberWorkspaceFixtures(this, [fixture])
  await addWorkspaceFromPicker(this, fixture)
  setCurrentWorkspace(this, fixture)
})

Given('我已添加了两个可区分的工作区', async function (this: CradleWorld) {
  const fixtures = [
    createWorkspaceFixture(this, 'cradle-e2e-alpha-', 'Alpha Workspace'),
    createWorkspaceFixture(this, 'cradle-e2e-beta-', 'Beta Workspace'),
  ]

  rememberWorkspaceFixtures(this, fixtures)

  for (const fixture of fixtures) {
    await addWorkspaceFromPicker(this, fixture)
  }
})

When('我打开当前工作区的详情页', async function (this: CradleWorld) {
  await openWorkspaceDetail(this, recallCurrentWorkspace(this))
})

When('我打开第 {int} 个工作区的详情页', async function (this: CradleWorld, ordinal: number) {
  await openWorkspaceDetail(this, recallWorkspaceByOrdinal(this, ordinal))
})

When('我将工作区重命名为 {string}', async function (this: CradleWorld, nextName: string) {
  const fixture = recallCurrentWorkspace(this)
  const detailPage = activeWorkspaceDetailPage(this)

  await detailPage.locator('[data-testid="workspace-detail-title-trigger"]').click()

  const titleInput = detailPage.locator('[data-testid="workspace-detail-title-input"]')
  await expect(titleInput).toBeVisible({ timeout: 10_000 })
  await titleInput.fill(nextName)
  await titleInput.press('Enter')

  await expect(detailPage.locator('[data-testid="workspace-detail-title-trigger"]')).toContainText(nextName, { timeout: 10_000 })

  updateRememberedWorkspaceName(this, fixture.id!, nextName)
})

Then('工作区详情页标题应该是 {string}', async function (this: CradleWorld, expectedName: string) {
  await expect(activeWorkspaceDetailPage(this).locator('[data-testid="workspace-detail-title-trigger"]')).toContainText(expectedName, { timeout: 10_000 })
})

Then('工作区列表中应该包含工作区 {string}', async function (this: CradleWorld, workspaceName: string) {
  await expect(this.page.locator('[data-testid^="workspace-open-"]').filter({ hasText: workspaceName })).toHaveCount(1, { timeout: 10_000 })
})

Then('数据库中的当前工作区名称应该是 {string}', async function (this: CradleWorld, expectedName: string) {
  const fixture = recallCurrentWorkspace(this)
  const persisted = await queryWorkspaceByPath(this, fixture.dir)

  expect(persisted).not.toBeNull()
  expect(persisted?.name).toBe(expectedName)
})

Then('工作区列表中应该包含这 {int} 个工作区', async function (this: CradleWorld, count: number) {
  const fixtures = recallWorkspaceFixtures(this)

  expect(fixtures).toHaveLength(count)
  await expect(this.page.locator('[data-testid^="workspace-group-"]')).toHaveCount(count, { timeout: 10_000 })

  for (const fixture of fixtures) {
    await expect(this.page.locator(`[data-testid="workspace-open-${fixture.id}"]`)).toContainText(fixture.name, { timeout: 10_000 })
  }
})

Then('工作区详情页应该显示第 {int} 个工作区的真实内容', async function (this: CradleWorld, ordinal: number) {
  await assertWorkspaceDetailContent(this, recallWorkspaceByOrdinal(this, ordinal))
})

Then('数据库中应该有 {int} 条工作区记录', async function (this: CradleWorld, count: number) {
  const rows = await queryDatabaseRows<PersistedWorkspaceRow>(
    this,
    `
      select
        id,
        name,
        path,
        created_at as createdAt,
        updated_at as updatedAt
      from workspaces
      order by created_at desc
    `,
  )

  expect(rows).toHaveLength(count)
})

Then('我应该看到工作区详情页的标签页', async function (this: CradleWorld) {
  const detailPage = activeWorkspaceDetailPage(this)

  await expect(detailPage.locator('[data-testid="workspace-detail-tab-overview"]')).toBeVisible({ timeout: 10_000 })
  await expect(detailPage.locator('[data-testid="workspace-detail-tab-workflow-rules"]')).toBeVisible({ timeout: 10_000 })
  await expect(detailPage.locator('[data-testid="workspace-detail-tab-skills"]')).toBeVisible({ timeout: 10_000 })
})

Then('Overview 应该显示当前工作区的 AGENTS.md 内容', async function (this: CradleWorld) {
  await assertWorkspaceDetailContent(this, recallCurrentWorkspace(this))
})
