// Input: SkillsService with mocked workspace DB lookup and mocked skills library functions
// Output: Unit tests for workspace-aware skills IPC behavior
// Position: Service-layer regression coverage for src/main/services/skills.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('../../db', () => ({
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

vi.mock('../../lib/skills', () => ({
  listSkillInventory,
  createSkillDocument,
}))

import { SkillsService } from '../skills'

describe('skillsService', () => {
  let service: SkillsService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new SkillsService()
  })

  it('resolves workspace ids before listing skills', async () => {
    listSkillInventory.mockReturnValueOnce([])

    await service.list('workspace-1')

    expect(listSkillInventory).toHaveBeenCalledWith('/tmp/workspace-1')
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
})
