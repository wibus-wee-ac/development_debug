// Input: WorkspaceService plus PackCodebaseEngine
// Output: pack-codebase capability semantics
// Position: apps/server/src/modules/pack-codebase/pack-codebase.service.ts

import { inject, injectable } from 'tsyringe'

import { AppError } from '../../errors/app-error'
import { WorkspaceService } from '../workspace/workspace.service'
import { PackCodebaseEngine, type PackCodebaseOptions } from './pack-codebase.engine'

@injectable()
export class PackCodebaseService {
  constructor(
    @inject(WorkspaceService) private readonly workspaces: WorkspaceService,
    @inject(PackCodebaseEngine) private readonly engine: PackCodebaseEngine,
  ) {}

  async packWorkspace(workspaceId: string, options: PackCodebaseOptions) {
    const workspace = this.workspaces.get(workspaceId)
    if (!workspace) {
      throw new AppError({
        code: 'workspace_not_found',
        status: 404,
        message: 'Workspace not found',
        details: { workspaceId },
      })
    }

    return this.engine.packWorkspace(workspace.path, options)
  }
}
