// Input: IpcService base, workspace DB lookup, pack-codebase feature
// Output: PackCodebaseService — IPC surface for packing a workspace to clipboard-ready string
// Position: Main-process IPC adapter bridging renderer pack requests to the repomix-backed feature

import { IpcMethod, IpcService } from '@cradle/ipc'
import { eq } from 'drizzle-orm'

import { getDb } from '../../db'
import { workspaces } from '../../db/schema'
import type { PackCodebaseOptions, PackCodebaseResult } from '../../features/pack-codebase/pack-codebase'
import { packCodebase } from '../../features/pack-codebase/pack-codebase'

interface PackCodebaseParams extends PackCodebaseOptions {
  workspaceId: string
}

export class PackCodebaseService extends IpcService {
  static readonly groupName = 'packCodebase'

  @IpcMethod()
  async pack(params: PackCodebaseParams): Promise<PackCodebaseResult> {
    const workspace = getDb()
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, params.workspaceId))
      .get()

    if (!workspace) {
      throw new Error(`Workspace not found: ${params.workspaceId}`)
    }

    const { workspaceId: _wid, ...options } = params
    return packCodebase(workspace.path, options)
  }
}
