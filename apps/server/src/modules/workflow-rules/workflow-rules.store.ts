// Input: workflow-rules config + filesystem APIs
// Output: filesystem-backed workflow rules store
// Position: apps/server/src/modules/workflow-rules/workflow-rules.store.ts

import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { injectable } from 'tsyringe'

import { AppError } from '../../errors/app-error'
import { WorkflowRulesConfig } from './workflow-rules.config'

const UNSAFE_ID_RE = /[/\\]|\.\./
const MD_EXT_RE = /\.md$/

export interface WorkflowRules {
  global: string | null
  profileSpecific: string | null
}

export interface WorkflowRuleEntry {
  type: 'global' | 'agent'
  agentProfileId: string | null
  content: string
}

@injectable()
export class WorkflowRulesStore {
  constructor(private readonly config: WorkflowRulesConfig) {}

  async get(workspaceId: string, agentProfileId?: string): Promise<WorkflowRules> {
    const globalPath = this.getGlobalRulePath(workspaceId)
    const profilePath = agentProfileId ? this.getAgentRulePath(workspaceId, agentProfileId) : null

    return {
      global: await this.readOptionalFile(globalPath),
      profileSpecific: profilePath ? await this.readOptionalFile(profilePath) : null,
    }
  }

  async save(workspaceId: string, agentProfileId: string | null, content: string): Promise<void> {
    const filePath = agentProfileId
      ? this.getAgentRulePath(workspaceId, agentProfileId)
      : this.getGlobalRulePath(workspaceId)

    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, content, 'utf8')
  }

  async delete(workspaceId: string, agentProfileId: string | null): Promise<void> {
    const filePath = agentProfileId
      ? this.getAgentRulePath(workspaceId, agentProfileId)
      : this.getGlobalRulePath(workspaceId)

    try {
      await unlink(filePath)
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }

  async list(workspaceId: string): Promise<WorkflowRuleEntry[]> {
    const entries: WorkflowRuleEntry[] = []
    const globalContent = await this.readOptionalFile(this.getGlobalRulePath(workspaceId))
    if (globalContent !== null) {
      entries.push({ type: 'global', agentProfileId: null, content: globalContent })
    }

    const agentsDir = join(this.getWorkspaceRoot(workspaceId), 'agents')
    let files: string[] = []
    try {
      files = await readdir(agentsDir)
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }

    for (const file of files.filter(file => file.endsWith('.md')).sort()) {
      const content = await this.readOptionalFile(join(agentsDir, file))
      if (content === null) {
        continue
      }
      entries.push({
        type: 'agent',
        agentProfileId: file.replace(MD_EXT_RE, ''),
        content,
      })
    }

    return entries
  }

  private getWorkspaceRoot(workspaceId: string): string {
    this.assertSafeId(workspaceId, 'workspaceId')
    return join(this.config.getRootDir(), workspaceId)
  }

  private getGlobalRulePath(workspaceId: string): string {
    return join(this.getWorkspaceRoot(workspaceId), 'rules.md')
  }

  private getAgentRulePath(workspaceId: string, agentProfileId: string): string {
    this.assertSafeId(agentProfileId, 'agentProfileId')
    return join(this.getWorkspaceRoot(workspaceId), 'agents', `${agentProfileId}.md`)
  }

  private assertSafeId(value: string, field: string): void {
    if (!value || UNSAFE_ID_RE.test(value)) {
      throw new AppError({
        code: 'invalid_workflow_rule_id',
        status: 400,
        message: `${field} is invalid`,
        details: { field, value },
      })
    }
  }

  private async readOptionalFile(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, 'utf8')
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw error
    }
  }
}
