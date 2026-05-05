// Input: WorkspaceService with mocked Electron shell helpers and injected workspace application service
// Output: Unit tests proving the workspace IPC adapter only forwards app-owned behavior
// Position: App-level IPC adapter tests for src/main/app/ipc/workspace.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceApplicationService } from '../../../workspace/workspace'
import { WorkspaceService } from '../workspace'

const { showOpenDialog, showItemInFolder, openPath } = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  showItemInFolder: vi.fn(),
  openPath: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  dialog: {
    showOpenDialog,
  },
  shell: {
    showItemInFolder,
    openPath,
  },
}))

vi.mock('../../../db', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        orderBy: () => ({ all: () => [] }),
        where: () => ({ get: () => undefined }),
      }),
    }),
    insert: () => ({ values: () => ({ returning: () => ({ get: () => undefined }) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => ({ get: () => undefined }) }) }) }),
    delete: () => ({ where: () => ({ run: () => undefined }) }),
  }),
}))

describe('workspaceService', () => {
  let appService: WorkspaceApplicationService
  let service: WorkspaceService

  beforeEach(() => {
    const workspace = {
      id: 'workspace-1',
      name: 'Workspace One',
      path: '/tmp/workspace-1',
      createdAt: 100,
      updatedAt: 100,
    }
    appService = {
      list: vi.fn(() => [workspace]),
      get: vi.fn(() => workspace),
      resolveByPath: vi.fn(() => workspace),
      addFromDirectory: vi.fn(() => workspace),
      create: vi.fn(() => workspace),
      update: vi.fn(() => ({ ...workspace, name: 'Workspace Renamed' })),
      delete: vi.fn(),
      listFiles: vi.fn(async () => [{ type: 'file' as const, name: 'README.md', path: 'README.md' }]),
      readTextFile: vi.fn(async () => '# Hello\n'),
      writeTextFile: vi.fn(async () => true),
    }
    service = new WorkspaceService(appService)
    showOpenDialog.mockReset()
    showItemInFolder.mockReset()
    openPath.mockReset()
  })

  it('delegates workspace CRUD and file access calls to the application service', async () => {
    expect(service.list()).toEqual([expect.objectContaining({ id: 'workspace-1' })])
    expect(service.get('workspace-1')).toEqual(expect.objectContaining({ id: 'workspace-1' }))
    expect(service.resolveByPath('/tmp/workspace-1')).toEqual(expect.objectContaining({ id: 'workspace-1' }))
    await expect(service.addFromDirectory('/tmp/workspace-1')).resolves.toEqual(expect.objectContaining({ id: 'workspace-1' }))
    expect(service.create({ name: 'Workspace One', path: '/tmp/workspace-1' })).toEqual(expect.objectContaining({ id: 'workspace-1' }))
    expect(service.update({ id: 'workspace-1', name: 'Workspace Renamed' })).toEqual(expect.objectContaining({ name: 'Workspace Renamed' }))
    service.delete('workspace-1')

    await expect(service.listFiles('workspace-1')).resolves.toEqual([{ type: 'file', name: 'README.md', path: 'README.md' }])
    await expect(service.readTextFile('workspace-1', 'README.md')).resolves.toBe('# Hello\n')
    await expect(service.writeTextFile('workspace-1', 'README.md', '# Updated\n')).resolves.toBe(true)

    expect(appService.list).toHaveBeenCalled()
    expect(appService.get).toHaveBeenCalledWith('workspace-1')
    expect(appService.resolveByPath).toHaveBeenCalledWith('/tmp/workspace-1')
    expect(appService.addFromDirectory).toHaveBeenCalledWith('/tmp/workspace-1')
    expect(appService.create).toHaveBeenCalledWith({ name: 'Workspace One', path: '/tmp/workspace-1' })
    expect(appService.update).toHaveBeenCalledWith({ id: 'workspace-1', name: 'Workspace Renamed' })
    expect(appService.delete).toHaveBeenCalledWith('workspace-1')
    expect(appService.listFiles).toHaveBeenCalledWith('workspace-1')
    expect(appService.readTextFile).toHaveBeenCalledWith('workspace-1', 'README.md')
    expect(appService.writeTextFile).toHaveBeenCalledWith('workspace-1', 'README.md', '# Updated\n')
  })

  it('keeps picker and shell calls as direct Electron transport helpers', async () => {
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/workspace-1'] })
    openPath.mockResolvedValueOnce('')

    await expect(service.selectDirectory()).resolves.toBe('/tmp/workspace-1')
    service.openInFinder('/tmp/workspace-1')
    await expect(service.openInDefaultApp('/tmp/workspace-1')).resolves.toBeUndefined()

    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ['openDirectory'],
      title: 'Select Workspace Directory',
    })
    expect(showItemInFolder).toHaveBeenCalledWith('/tmp/workspace-1')
    expect(openPath).toHaveBeenCalledWith('/tmp/workspace-1')
  })
})