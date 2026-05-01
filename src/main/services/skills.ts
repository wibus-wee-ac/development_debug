// Input: IpcService base, workspace DB lookup, filesystem-backed skills library
// Output: SkillsService IPC handler for listing, reading, writing, importing, and exporting skill packages
// Position: Main-process service exposing filesystem skill management to the renderer

import { IpcMethod, IpcService } from '@cradle/ipc'
import { eq } from 'drizzle-orm'

import { getDb } from '../db'
import { workspaces } from '../db/schema'
import type {
  CreateSkillInput,
  ExportSkillInput,
  ImportSkillInput,
  SkillDocument,
  SkillInventoryEntry,
  SkillLookup,
  SkillScope,
  UpdateSkillInput,
} from '../lib/skills'
import {
  createSkillDocument,
  deleteSkillDocument,
  exportSkillPackage,
  importSkillPackage,
  listSkillInventory,
  readSkillDocument,
  updateSkillDocument,
} from '../lib/skills'

interface SkillLookupParams extends Omit<SkillLookup, 'workspacePath'> {
  workspaceId?: string | null
}

interface CreateSkillParams extends Omit<CreateSkillInput, 'workspacePath'> {
  scope: SkillScope
  workspaceId?: string | null
}

interface UpdateSkillParams extends Omit<UpdateSkillInput, 'workspacePath'> {
  workspaceId?: string | null
}

interface ImportSkillParams extends Omit<ImportSkillInput, 'workspacePath'> {
  scope: SkillScope
  workspaceId?: string | null
}

interface ExportSkillParams extends Omit<ExportSkillInput, 'workspacePath'> {
  workspaceId?: string | null
}

export class SkillsService extends IpcService {
  static readonly groupName = 'skills'

  @IpcMethod()
  async list(workspaceId?: string | null): Promise<SkillInventoryEntry[]> {
    return listSkillInventory(this.resolveWorkspacePath(workspaceId))
  }

  @IpcMethod()
  async get(params: SkillLookupParams): Promise<SkillDocument> {
    return readSkillDocument({
      scope: params.scope,
      name: params.name,
      workspacePath: this.resolveWorkspacePath(params.workspaceId),
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
    })
  }

  @IpcMethod()
  async update(params: UpdateSkillParams): Promise<SkillDocument> {
    return updateSkillDocument({
      scope: params.scope,
      name: params.name,
      workspacePath: this.resolveWorkspacePath(params.workspaceId),
      document: params.document,
    })
  }

  @IpcMethod()
  async delete(params: SkillLookupParams): Promise<void> {
    return deleteSkillDocument({
      scope: params.scope,
      name: params.name,
      workspacePath: this.resolveWorkspacePath(params.workspaceId),
    })
  }

  @IpcMethod()
  async import(params: ImportSkillParams): Promise<SkillDocument> {
    return importSkillPackage(params.scope, {
      sourceDir: params.sourceDir,
      overwrite: params.overwrite,
      workspacePath: this.resolveWorkspacePath(params.workspaceId),
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
    })
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
