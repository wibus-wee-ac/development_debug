// Input: Cucumber terminal journey steps, shared chat/workspace setup state, and Playwright keyboard assertions
// Output: Bottom-shell E2E steps that validate the user-visible PTY panel against a real workspace path
// Position: E2E step layer for terminal.feature, focused on shell panel value rather than PTY internals

import { createHash } from 'node:crypto'

import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world'

const TERMINAL_TIMEOUT = 30_000

function getBottomPanel(world: CradleWorld) {
  return world.page.locator('[data-testid="app-layout-bottom-panel"]')
}

function getShellView(world: CradleWorld) {
  return world.page.locator('[data-testid="shell-view"]')
}

async function readShellVisibleText(world: CradleWorld): Promise<string> {
  return (await world.page.locator('[data-testid="shell-view-transcript"]').textContent()) ?? ''
}

function normalizeTerminalAssertionText(value: string): string {
  return value.replace(/[·\s]+/g, '')
}

async function getActiveChatWorkspacePath(world: CradleWorld): Promise<string> {
  const chatView = world.page.locator('[data-tab-visible="true"] [data-testid="chat-view"]').first()
  await expect(chatView).toBeVisible({ timeout: 10_000 })

  const sessionId = await chatView.getAttribute('data-chat-session-id')
  if (!sessionId) {
    throw new Error('Expected active chat view to expose a chat session id')
  }

  const sessionResponse = await fetch(`${world.params.serverUrl}/sessions/${sessionId}`)
  if (!sessionResponse.ok) {
    throw new Error(`Failed to load session ${sessionId}: ${sessionResponse.status} ${await sessionResponse.text()}`)
  }

  const session = await sessionResponse.json() as { workspaceId?: string | null }
  if (!session.workspaceId) {
    throw new Error(`Expected session ${sessionId} to have a workspaceId`)
  }

  const workspaceResponse = await fetch(`${world.params.serverUrl}/workspaces/${session.workspaceId}`)
  if (!workspaceResponse.ok) {
    throw new Error(`Failed to load workspace ${session.workspaceId}: ${workspaceResponse.status} ${await workspaceResponse.text()}`)
  }

  const workspace = await workspaceResponse.json() as { path?: string | null }
  if (!workspace.path) {
    throw new Error(`Expected workspace ${session.workspaceId} to have a path`)
  }

  return workspace.path
}

When('我打开底部终端面板', async function (this: CradleWorld) {
  console.warn('[step] open bottom terminal panel')
  const toggle = this.page.locator('[data-testid="app-header-panel-toggle"]')
  const panel = getBottomPanel(this)

  await expect(toggle).toBeVisible({ timeout: 10_000 })
  if ((await panel.getAttribute('data-panel-open')) !== 'true') {
    await toggle.click()
  }

  await expect(panel).toHaveAttribute('data-panel-open', 'true', { timeout: 10_000 })
})

Then('我应该看到底部终端面板', async function (this: CradleWorld) {
  console.warn('[step] assert bottom terminal panel visible')
  const panel = getBottomPanel(this)
  const shellView = getShellView(this)

  await expect(panel).toHaveAttribute('data-panel-open', 'true', { timeout: 10_000 })
  await expect(shellView).toBeVisible({ timeout: TERMINAL_TIMEOUT })
})

When('我在底部终端中执行命令{string}', async function (this: CradleWorld, command: string) {
  console.warn(`[step] run command in bottom terminal: ${command}`)
  const shellView = getShellView(this)

  await expect(shellView).toBeVisible({ timeout: TERMINAL_TIMEOUT })
  await shellView.click({ position: { x: 24, y: 24 } })
  await this.page.keyboard.type(command)
  await this.page.keyboard.press('Enter')
})

Then('底部终端应显示当前工作区路径哈希', async function (this: CradleWorld) {
  console.warn('[step] assert bottom terminal shows current workspace path hash')
  const workspacePath = await getActiveChatWorkspacePath(this)
  const expectedHash = createHash('sha1').update(`${workspacePath}\n`).digest('hex')

  await expect.poll(
    async () => normalizeTerminalAssertionText(await readShellVisibleText(this)),
    { timeout: TERMINAL_TIMEOUT },
  ).toContain(expectedHash)
})
