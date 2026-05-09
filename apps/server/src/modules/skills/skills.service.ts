// Input: workspace DB resolution, skills store, and skill-source store
// Output: skills capability orchestration for HTTP surface
// Position: apps/server/src/modules/skills/skills.service.ts

import { workspaces } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { inject, injectable } from 'tsyringe'

import { DbAccessor } from '../../database/db-accessor'
import { AppError } from '../../errors/app-error'
import type { DiscoveredSkill, ParsedSkillSource } from './skill-source.store'
import { cleanupFetchSession, fetchSkillsFromSource, getFetchSession } from './skill-source.store'
import type {
  CreateSkillInput,
  ExportSkillInput,
  ImportSkillInput,
  SkillDocument,
  SkillInventoryEntry,
  SkillLookup,
  UpdateSkillInput,
} from './skills.store'
import {
  createSkillDocument,
  deleteSkillDocument,
  exportSkillPackage,
  importMultipleSkillPackages,
  importSkillPackage,
  listSkillInventory,
  readSkillDocument,
  updateSkillDocument,
} from './skills.store'
import type { SkillScope } from './skills-paths'

@injectable()
export class SkillsService {
  constructor(@inject(DbAccessor) private readonly dbAccessor: DbAccessor) {}

  list(params?: { workspaceId?: string | null, agentId?: string | null }): Promise<SkillInventoryEntry[]> {
    return this.wrapAsync(() => Promise.resolve(listSkillInventory({
      workspacePath: this.resolveWorkspacePath(params?.workspaceId),
      agentId: params?.agentId ?? undefined,
    })))
  }

  get(params: Omit<SkillLookup, 'workspacePath' | 'agentId'> & { workspaceId?: string | null, agentId?: string | null }): Promise<SkillDocument> {
    return this.wrapAsync(() => readSkillDocument({
      scope: params.scope,
      name: params.name,
      workspacePath: this.resolveWorkspacePath(params.workspaceId),
      agentId: params.agentId ?? undefined,
    }))
  }

  create(params: Omit<CreateSkillInput, 'workspacePath' | 'agentId'> & { scope: SkillScope, workspaceId?: string | null, agentId?: string | null }): Promise<SkillDocument> {
    return this.wrapAsync(() => createSkillDocument(params.scope, {
      name: params.name,
      description: params.description,
      body: params.body,
      frontmatter: params.frontmatter,
      workspacePath: this.resolveWorkspacePath(params.workspaceId),
      agentId: params.agentId ?? undefined,
    }))
  }

  update(params: Omit<UpdateSkillInput, 'workspacePath' | 'agentId'> & { workspaceId?: string | null, agentId?: string | null }): Promise<SkillDocument> {
    return this.wrapAsync(() => updateSkillDocument({
      scope: params.scope,
      name: params.name,
      document: params.document,
      workspacePath: this.resolveWorkspacePath(params.workspaceId),
      agentId: params.agentId ?? undefined,
    }))
  }

  delete(params: Omit<SkillLookup, 'workspacePath' | 'agentId'> & { workspaceId?: string | null, agentId?: string | null }): Promise<void> {
    return this.wrapAsync(() => deleteSkillDocument({
      scope: params.scope,
      name: params.name,
      workspacePath: this.resolveWorkspacePath(params.workspaceId),
      agentId: params.agentId ?? undefined,
    }))
  }

  import(params: Omit<ImportSkillInput, 'workspacePath' | 'agentId'> & { scope: SkillScope, workspaceId?: string | null, agentId?: string | null }): Promise<SkillDocument> {
    return this.wrapAsync(() => importSkillPackage(params.scope, {
      sourceDir: params.sourceDir,
      overwrite: params.overwrite,
      workspacePath: this.resolveWorkspacePath(params.workspaceId),
      agentId: params.agentId ?? undefined,
    }))
  }

  export(params: Omit<ExportSkillInput, 'workspacePath' | 'agentId'> & { workspaceId?: string | null, agentId?: string | null }): Promise<string> {
    return this.wrapAsync(() => exportSkillPackage({
      scope: params.scope,
      name: params.name,
      destinationDir: params.destinationDir,
      overwrite: params.overwrite,
      workspacePath: this.resolveWorkspacePath(params.workspaceId),
      agentId: params.agentId ?? undefined,
    }))
  }

  async fetchSource(source: string): Promise<{ sessionId: string, source: ParsedSkillSource, skills: DiscoveredSkill[] }> {
    return this.wrapAsync(async () => {
      const result = await fetchSkillsFromSource(source)
      return { sessionId: result.sessionId, source: result.source, skills: result.skills }
    })
  }

  async importFromFetch(params: { sessionId: string, selectedDirs: string[], scope: SkillScope, overwrite?: boolean, workspaceId?: string | null, agentId?: string | null }): Promise<{ imported: SkillDocument[], errors: Array<{ dir: string, error: string }> }> {
    return this.wrapAsync(async () => {
      const session = getFetchSession(params.sessionId)
      if (!session) {
        throw new AppError({
          code: 'skills_fetch_session_not_found',
          status: 404,
          message: 'Fetch session not found',
          details: { sessionId: params.sessionId },
        })
      }

      const allowedDirs = new Set(session.skills.map(skill => skill.skillDir))
      for (const dir of params.selectedDirs) {
        if (!allowedDirs.has(dir)) {
          throw new AppError({
            code: 'invalid_skills_input',
            status: 400,
            message: 'selectedDirs must come from the fetch session results',
            details: { dir },
          })
        }
      }

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
    })
  }

  cancelFetch(sessionId: string): Promise<void> {
    return this.wrapAsync(() => cleanupFetchSession(sessionId))
  }

  private resolveWorkspacePath(workspaceId?: string | null): string | undefined {
    if (!workspaceId) {
      return undefined
    }
    const workspace = this.dbAccessor.get().select().from(workspaces).where(eq(workspaces.id, workspaceId)).get()
    if (!workspace) {
      throw new AppError({
        code: 'skills_workspace_not_found',
        status: 404,
        message: 'Workspace not found',
        details: { workspaceId },
      })
    }
    return workspace.path
  }

  private async wrapAsync<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    }
    catch (error) {
      throw this.mapError(error)
    }
  }

  private mapError(error: unknown): Error {
    if (error instanceof AppError) {
      return error
    }

    const message = error instanceof Error ? error.message : String(error)

    if (message.endsWith('skills are read-only')) {
      return new AppError({
        code: 'skills_scope_read_only',
        status: 400,
        message,
      })
    }

    if (message.startsWith('Skill not found:')) {
      return new AppError({
        code: 'skill_not_found',
        status: 404,
        message: 'Skill not found',
        details: { source: message },
      })
    }

    if (message.startsWith('Skill already exists:') || message.includes('already exists') || message.startsWith('Export destination already exists:')) {
      return new AppError({
        code: 'skills_conflict',
        status: 409,
        message,
      })
    }

    if (message.startsWith('Workspace not found:')) {
      return new AppError({
        code: 'skills_workspace_not_found',
        status: 404,
        message: 'Workspace not found',
      })
    }

    if (
      message.startsWith('Invalid ID:')
      || message === 'workspacePath is required for workspace skills'
      || message === 'agentId is required for agent skills'
      || message === 'Skill name is required'
    ) {
      return new AppError({
        code: 'invalid_skills_input',
        status: 400,
        message,
      })
    }

    if (
      message.startsWith('Cannot parse skill source:')
      || message.startsWith('Local path not found:')
      || message.startsWith('Failed to clone repository:')
      || message.startsWith('Authentication failed for ')
      || message.startsWith('Path not found in repository:')
      || message.includes('SKILL.md')
      || message.startsWith('Unsafe subpath:')
    ) {
      return new AppError({
        code: 'invalid_skills_source',
        status: 400,
        message,
      })
    }

    return error instanceof Error ? error : new Error(message)
  }
}
