// Input: WorkspaceStore + WorkspaceFiles
// Output: workspace module semantics
// Position: apps/server/src/modules/workspace/workspace.service.ts

import { basename } from 'node:path'

import { injectable } from 'tsyringe'

import type { Workspace } from '@cradle/db'

import { AppError } from '../../errors/app-error'
import { WorkspaceFiles, type WorkspaceFileEntry } from './workspace.files'
import { WorkspaceStore } from './workspace.store'

@injectable()
export class WorkspaceService {
  constructor(
    private readonly store: WorkspaceStore,
    private readonly files: WorkspaceFiles
  ) {}

  list(): Workspace[] {
    return this.store.list()
  }

  get(id: string): Workspace | null {
    return this.store.get(id) ?? null
  }

  resolveByPath(path: string): Workspace | null {
    return this.store.resolveByPath(path) ?? null
  }

  addFromDirectory(path: string): Workspace {
    return this.create({ name: basename(path), path })
  }

  create(input: { name: string; path: string }): Workspace {
    try {
      return this.store.create(input)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message.includes('UNIQUE constraint failed: workspaces.path')) {
        throw new AppError({
          code: 'workspace_path_exists',
          status: 409,
          message: 'Workspace path already exists',
          details: { path: input.path },
        })
      }
      throw error
    }
  }

  update(input: { id: string; name: string }): Workspace | null {
    return this.store.update(input) ?? null
  }

  delete(id: string): void {
    this.store.delete(id)
  }

  async listFiles(workspaceId: string): Promise<WorkspaceFileEntry[]> {
    const workspace = this.store.get(workspaceId)
    if (!workspace) {
      return []
    }
    return this.files.listFiles(workspace.path)
  }

  async readTextFile(workspaceId: string, relativePath: string): Promise<string | null> {
    const workspace = this.store.get(workspaceId)
    if (!workspace) {
      return null
    }
    return this.files.readTextFile(workspace.path, relativePath)
  }

  async writeTextFile(workspaceId: string, relativePath: string, content: string): Promise<boolean> {
    const workspace = this.store.get(workspaceId)
    if (!workspace) {
      return false
    }
    return this.files.writeTextFile(workspace.path, relativePath, content)
  }
}
