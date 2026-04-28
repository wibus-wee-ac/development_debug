// Input: IpcService base, workflow-rules filesystem utilities
// Output: WorkflowRulesService IPC handler for reading/writing workflow rules
// Position: Main-process service exposing workflow rules CRUD to renderer

import { IpcMethod, IpcService } from '@cradle/ipc'

import type { WorkflowRuleEntry, WorkflowRules } from '../lib/workflow-rules'
import { deleteWorkflowRule, getWorkflowRules, listWorkflowRules, saveWorkflowRule } from '../lib/workflow-rules'

export class WorkflowRulesService extends IpcService {
  static readonly groupName = 'workflowRules'

  @IpcMethod()
  async get(workspaceId: string, agentProfileId?: string): Promise<WorkflowRules> {
    return getWorkflowRules(workspaceId, agentProfileId)
  }

  @IpcMethod()
  async save(workspaceId: string, agentProfileId: string | null, content: string): Promise<void> {
    return saveWorkflowRule(workspaceId, agentProfileId, content)
  }

  @IpcMethod()
  async delete(workspaceId: string, agentProfileId: string | null): Promise<void> {
    return deleteWorkflowRule(workspaceId, agentProfileId)
  }

  @IpcMethod()
  async list(workspaceId: string): Promise<WorkflowRuleEntry[]> {
    return listWorkflowRules(workspaceId)
  }
}
