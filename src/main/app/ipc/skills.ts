// Input: IpcService base, workspace DB lookup, filesystem-backed skills library, skill-source fetcher
// Output: SkillsService IPC handler for listing, reading, writing, importing, exporting, and remote-fetching skill packages across shared, workspace, and agent roots
// Position: Main-process service exposing filesystem skill management to the renderer

import { IpcMethod, IpcService } from '@cradle/ipc'
import { eq } from 'drizzle-orm'

import { getDb } from '../../db'
import { workspaces } from '../../db/schema'
import type { DiscoveredSkill, ParsedSkillSource } from '../../skills/skill-source'
import { cleanupFetchSession, fetchSkillsFromSource } from '../../skills/skill-source'
import type {
  CreateSkillInput,
  ExportSkillInput,
  ImportSkillInput,
  SkillDocument,
  SkillInventoryEntry,
  SkillLookup,
  SkillScope,
  UpdateSkillInput,
} from '../../skills/skills'
import {
  createSkillDocument,
  deleteSkillDocument,
  exportSkillPackage,
  importMultipleSkillPackages,
  importSkillPackage,
  listSkillInventory,
  readSkillDocument,
  updateSkillDocument,
} from '../../skills/skills'

interface SkillLookupParams extends Omit<SkillLookup, 'workspacePath' | 'agentId'> {
  workspaceId?: string | null
  agentId?: string | null
}

interface CreateSkillParams extends Omit<CreateSkillInput, 'workspacePath' | 'agentId'> {
  scope: SkillScope
  workspaceId?: string | null
  agentId?: string | null
}

interface UpdateSkillParams extends Omit<UpdateSkillInput, 'workspacePath' | 'agentId'> {
  workspaceId?: string | null
  agentId?: string | null
}

interface ImportSkillParams extends Omit<ImportSkillInput, 'workspacePath' | 'agentId'> {
  scope: SkillScope
  workspaceId?: string | null
  agentId?: string | null
}

interface ExportSkillParams extends Omit<ExportSkillInput, 'workspacePath' | 'agentId'> {
  workspaceId?: string | null
  agentId?: string | null
}

interface SkillListParams {
  workspaceId?: string | null
  agentId?: string | null
}

export class SkillsService extends IpcService {
  static readonly groupName = 'skills'

  @IpcMethod()
  async list(params?: SkillListParams): Promise<SkillInventoryEntry[]> {
    return listSkillInventory({
      workspacePath: this.resolveWorkspacePath(params?.workspaceId),
      agentId: params?.agentId ?? undefined,
    })
  }

  @IpcMethod()
  async get(params: SkillLookupParams): Promise<SkillDocument> {
    return readSkillDocument({
      scope: params.scope,
      name: params.name,
      workspacePath: this.resolveWorkspacePath(params.workspaceId),
      agentId: params.agentId ?? undefined,
    })
  }

  @IpcMethod()
  async create(params: CreateSkillParams): Promise<SkillDocument> {
    return createSkillDocument(params.scope, {
      name: params.name,
      description: params.description,
      body: params.body,
      frontmatter: params.frontmatter,
      workspacePath: this.resolveWorkspacePath(params.workspaceId),
      agentId: params.agentId ?? undefined,
    })
  }

  @IpcMethod()
  async update(params: UpdateSkillParams): Promise<SkillDocument> {
    return updateSkillDocument({
      scope: params.scope,
      name: params.name,
      workspacePath: this.resolveWorkspacePath(params.workspaceId),
      agentId: params.agentId ?? undefined,
      document: params.document,
    })
  }

  @IpcMethod()
  async delete(params: SkillLookupParams): Promise<void> {
    return deleteSkillDocument({
      scope: params.scope,
      name: params.name,
      workspacePath: this.resolveWorkspacePath(params.workspaceId),
      agentId: params.agentId ?? undefined,
    })
  }

  @IpcMethod()
  async import(params: ImportSkillParams): Promise<SkillDocument> {
    return importSkillPackage(params.scope, {
      sourceDir: params.sourceDir,
      overwrite: params.overwrite,
      workspacePath: this.resolveWorkspacePath(params.workspaceId),
      agentId: params.agentId ?? undefined,
    })
  }

  @IpcMethod()
  async export(params: ExportSkillParams): Promise<string> {
    return exportSkillPackage({
      scope: params.scope,
      name: params.name,
      destinationDir: params.destinationDir,
      overwrite: params.overwrite,
      workspacePath: this.resolveWorkspacePath(params.workspaceId),
      agentId: params.agentId ?? undefined,
    })
  }

  /**
   * Fetch and discover skills from a remote URL or local path.
   * Returns a session ID for subsequent `importFromFetch` call.
   * Always call `importFromFetch` (or a cleanup endpoint) to release the temp dir.
   */
  @IpcMethod()
  async fetchSource(params: { source: string }): Promise<{
    sessionId: string
    source: ParsedSkillSource
    skills: DiscoveredSkill[]
  }> {
    const result = await fetchSkillsFromSource(params.source)
    return {
      sessionId: result.sessionId,
      source: result.source,
      skills: result.skills,
    }
  }

  /**
   * Import selected skills from a previously fetched session and clean up the temp dir.
   */
  @IpcMethod()
  async importFromFetch(params: {
    sessionId: string
    selectedDirs: string[]
    scope: SkillScope
    overwrite?: boolean
    workspaceId?: string | null
    agentId?: string | null
  }): Promise<{ imported: SkillDocument[], errors: Array<{ dir: string, error: string }> }> {
    try {
      return await importMultipleSkillPackages(params.scope, {
        sourceDirs: params.selectedDirs,
        overwrite: params.overwrite,
        workspacePath: this.resolveWorkspacePath(params.workspaceId),
        agentId: params.agentId ?? undefined,
      })
    }
    finally {
      await cleanupFetchSession(params.sessionId)
    }
  }

  /**
   * Cancel a fetch session and clean up its temp dir without importing.
   */
  @IpcMethod()
  async cancelFetch(params: { sessionId: string }): Promise<void> {
    await cleanupFetchSession(params.sessionId)
  }

  private resolveWorkspacePath(workspaceId?: string | null): string | undefined {
    if (!workspaceId) {
      return undefined
    }

    const workspace = getDb()
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .get()

    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`)
    }

    return workspace.path
  }
}
