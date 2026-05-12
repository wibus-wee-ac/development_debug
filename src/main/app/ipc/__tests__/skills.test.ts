// Input: SkillsService with mocked workspace DB lookup and mocked skills library functions
// Output: Unit tests for workspace-aware and agent-aware skills IPC behavior
// Position: Service-layer regression coverage for src/main/app/ipc/skills.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SkillsService } from '../skills'

const { listSkillInventory, createSkillDocument } = vi.hoisted(() => ({
  listSkillInventory: vi.fn(),
  createSkillDocument: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}))

vi.mock('../../../db', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          get: () => ({
            id: 'workspace-1',
            path: '/tmp/workspace-1',
          }),
        }),
      }),
    }),
  }),
}))

vi.mock('../../../skills/skills', () => ({
  listSkillInventory,
  createSkillDocument,
}))

describe('skillsService', () => {
  let service: SkillsService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new SkillsService()
  })

  it('resolves workspace ids before listing skills', async () => {
    listSkillInventory.mockReturnValueOnce([])

    await service.list({ workspaceId: 'workspace-1' })

    expect(listSkillInventory).toHaveBeenCalledWith({
      workspacePath: '/tmp/workspace-1',
    })
  })

  it('passes the resolved workspace path to workspace skill creation', async () => {
    createSkillDocument.mockResolvedValueOnce({
      name: 'workspace-skill',
      description: 'desc',
      body: '# Skill\n',
    })

    await service.create({
      workspaceId: 'workspace-1',
      scope: 'workspace',
      name: 'workspace-skill',
      description: 'desc',
      body: '# Skill\n',
    })

    expect(createSkillDocument).toHaveBeenCalledWith('workspace', {
      name: 'workspace-skill',
      description: 'desc',
      body: '# Skill\n',
      workspacePath: '/tmp/workspace-1',
    })
  })

  it('passes agent ids through for agent-private skill creation', async () => {
    createSkillDocument.mockResolvedValueOnce({
      name: 'agent-skill',
      description: 'desc',
      body: '# Skill\n',
    })

    await service.create({
      scope: 'agent',
      agentId: 'agent-123',
      name: 'agent-skill',
      description: 'desc',
      body: '# Skill\n',
    })

    expect(createSkillDocument).toHaveBeenCalledWith('agent', {
      agentId: 'agent-123',
      name: 'agent-skill',
      description: 'desc',
      body: '# Skill\n',
      workspacePath: undefined,
    })
  })
})
