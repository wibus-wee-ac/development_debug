import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('workflow rules library', () => {
  let sandboxDir: string
  let homeDir: string
  let previousHome: string | undefined

  beforeEach(async () => {
    sandboxDir = await mkdtemp(join(os.tmpdir(), 'cradle-workflow-rules-test-'))
    homeDir = join(sandboxDir, 'home')
    previousHome = process.env.HOME
    process.env.HOME = homeDir
    vi.resetModules()
  })

  afterEach(async () => {
    if (previousHome === undefined) {
      delete process.env.HOME
    }
    else {
      process.env.HOME = previousHome
    }

    vi.resetModules()
    await rm(sandboxDir, { recursive: true, force: true })
  })

  it('saves, reads, lists, and deletes global and agent workflow rules', async () => {
    const workflowRules = await import('../workflow-rules')

    await workflowRules.saveWorkflowRule('workspace-1', null, 'global rule')
    await workflowRules.saveWorkflowRule('workspace-1', 'agent-1', 'agent rule')

    await expect(readFile(join(homeDir, '.cradle', 'workflows', 'workspace-1', 'rules.md'), 'utf8')).resolves.toBe('global rule')
    await expect(readFile(join(homeDir, '.cradle', 'workflows', 'workspace-1', 'agents', 'agent-1.md'), 'utf8')).resolves.toBe('agent rule')

    await expect(workflowRules.getWorkflowRules('workspace-1', 'agent-1')).resolves.toEqual({
      global: 'global rule',
      profileSpecific: 'agent rule',
    })

    await expect(workflowRules.listWorkflowRules('workspace-1')).resolves.toEqual([
      { type: 'global', agentProfileId: null, content: 'global rule' },
      { type: 'agent', agentProfileId: 'agent-1', content: 'agent rule' },
    ])

    await workflowRules.deleteWorkflowRule('workspace-1', 'agent-1')
    await workflowRules.deleteWorkflowRule('workspace-1', null)

    await expect(workflowRules.getWorkflowRules('workspace-1', 'agent-1')).resolves.toEqual({
      global: null,
      profileSpecific: null,
    })
    await expect(workflowRules.listWorkflowRules('workspace-1')).resolves.toEqual([])
  })

  it('returns null for missing workflow rules without creating files', async () => {
    const workflowRules = await import('../workflow-rules')

    await expect(workflowRules.getWorkflowRules('workspace-2', 'agent-2')).resolves.toEqual({
      global: null,
      profileSpecific: null,
    })
    await expect(workflowRules.listWorkflowRules('workspace-2')).resolves.toEqual([])
  })

  it('rejects unsafe workspace or agent ids instead of swallowing them as missing files', async () => {
    const workflowRules = await import('../workflow-rules')

    await expect(workflowRules.getWorkflowRules('../bad-workspace')).rejects.toThrow(/Invalid ID/)
    await expect(workflowRules.getWorkflowRules('workspace-1', '../bad-agent')).rejects.toThrow(/Invalid ID/)
    await expect(workflowRules.saveWorkflowRule('../bad-workspace', null, 'x')).rejects.toThrow(/Invalid ID/)
    await expect(workflowRules.deleteWorkflowRule('workspace-1', '../bad-agent')).rejects.toThrow(/Invalid ID/)
  })
})