// Input: temp workspace directories plus fake workspace store
// Output: Regression tests for workspace application service file filtering, safe text IO, and CRUD delegation
// Position: Feature tests for src/main/features/workspace/workspace.ts

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createWorkspaceApplicationService } from '../workspace'

describe('workspace application service', () => {
  let sandboxDir: string
  let workspacePath: string

  beforeEach(async () => {
    sandboxDir = await mkdtemp(join(os.tmpdir(), 'cradle-workspace-feature-'))
    workspacePath = join(sandboxDir, 'workspace')
    await mkdir(workspacePath, { recursive: true })
  })

  afterEach(async () => {
    await rm(sandboxDir, { recursive: true, force: true })
  })

  it('delegates workspace record CRUD to the store', () => {
    const workspace = {
      id: 'workspace-1',
      name: 'Demo Workspace',
      path: workspacePath,
      createdAt: 100,
      updatedAt: 100,
    }
    const store = {
      list: vi.fn(() => [workspace]),
      get: vi.fn(() => workspace),
      resolveByPath: vi.fn(() => workspace),
      create: vi.fn(() => workspace),
      update: vi.fn(() => ({ ...workspace, name: 'Renamed Workspace' })),
      delete: vi.fn(),
    }
    const service = createWorkspaceApplicationService({ store })

    expect(service.list()).toEqual([workspace])
    expect(service.get('workspace-1')).toEqual(workspace)
    expect(service.resolveByPath(workspacePath)).toEqual(workspace)
    expect(service.addFromDirectory(workspacePath)).toEqual(workspace)
    expect(service.create({ name: 'Demo Workspace', path: workspacePath })).toEqual(workspace)
    expect(service.update({ id: 'workspace-1', name: 'Renamed Workspace' })).toEqual({
      ...workspace,
      name: 'Renamed Workspace',
    })
    service.delete('workspace-1')

    expect(store.list).toHaveBeenCalled()
    expect(store.get).toHaveBeenCalledWith('workspace-1')
    expect(store.resolveByPath).toHaveBeenCalledWith(workspacePath)
    expect(store.create).toHaveBeenCalledWith({ name: 'workspace', path: workspacePath })
    expect(store.create).toHaveBeenCalledWith({ name: 'Demo Workspace', path: workspacePath })
    expect(store.update).toHaveBeenCalledWith({ id: 'workspace-1', name: 'Renamed Workspace' })
    expect(store.delete).toHaveBeenCalledWith('workspace-1')
  })

  it('lists workspace files while honoring .gitignore and default ignore rules', async () => {
    await writeFile(join(workspacePath, '.gitignore'), 'ignored.txt\nignored-dir/\n', 'utf8')
    await mkdir(join(workspacePath, 'src'), { recursive: true })
    await mkdir(join(workspacePath, 'ignored-dir'), { recursive: true })
    await mkdir(join(workspacePath, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(workspacePath, 'src', 'main.ts'), 'console.log("hi")\n', 'utf8')
    await writeFile(join(workspacePath, 'notes.md'), '# Notes\n', 'utf8')
    await writeFile(join(workspacePath, 'ignored.txt'), 'nope\n', 'utf8')
    await writeFile(join(workspacePath, 'ignored-dir', 'keep-out.md'), 'nope\n', 'utf8')
    await writeFile(join(workspacePath, 'node_modules', 'pkg', 'index.js'), 'module.exports = {}\n', 'utf8')

    const workspace = {
      id: 'workspace-1',
      name: 'Demo Workspace',
      path: workspacePath,
      createdAt: 100,
      updatedAt: 100,
    }
    const service = createWorkspaceApplicationService({
      store: {
        list: () => [workspace],
        get: () => workspace,
        resolveByPath: () => workspace,
        create: () => workspace,
        update: () => workspace,
        delete: () => {},
      },
    })

    const entries = await service.listFiles('workspace-1')

    expect(entries).toEqual(expect.arrayContaining([
      { type: 'directory', name: 'src', path: 'src' },
      { type: 'file', name: 'main.ts', path: 'src/main.ts' },
      { type: 'file', name: 'notes.md', path: 'notes.md' },
    ]))
    expect(entries.some(entry => entry.path === 'ignored.txt')).toBe(false)
    expect(entries.some(entry => entry.path.startsWith('ignored-dir'))).toBe(false)
    expect(entries.some(entry => entry.path.startsWith('node_modules'))).toBe(false)
  })

  it('blocks path traversal while allowing safe workspace text IO', async () => {
    await writeFile(join(workspacePath, 'notes.md'), 'original text\n', 'utf8')

    const workspace = {
      id: 'workspace-1',
      name: 'Demo Workspace',
      path: workspacePath,
      createdAt: 100,
      updatedAt: 100,
    }
    const service = createWorkspaceApplicationService({
      store: {
        list: () => [workspace],
        get: () => workspace,
        resolveByPath: () => workspace,
        create: () => workspace,
        update: () => workspace,
        delete: () => {},
      },
    })

    await expect(service.readTextFile('workspace-1', 'notes.md')).resolves.toBe('original text\n')
    await expect(service.readTextFile('workspace-1', '../outside.md')).resolves.toBeNull()

    await expect(service.writeTextFile('workspace-1', 'notes.md', 'updated text\n')).resolves.toBe(true)
    await expect(service.writeTextFile('workspace-1', '../outside.md', 'bad\n')).resolves.toBe(false)

    expect(await readFile(join(workspacePath, 'notes.md'), 'utf8')).toBe('updated text\n')
  })
})
