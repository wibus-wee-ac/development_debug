// Input: workflow-rules store
// Output: workflow-rules capability semantics
// Position: apps/server/src/modules/workflow-rules/workflow-rules.service.ts

import { injectable } from 'tsyringe'

import type { WorkflowRuleEntry, WorkflowRules } from './workflow-rules.store'
import { WorkflowRulesStore } from './workflow-rules.store'

@injectable()
export class WorkflowRulesService {
  constructor(private readonly store: WorkflowRulesStore) {}

  get(workspaceId: string, agentProfileId?: string): Promise<WorkflowRules> {
    return this.store.get(workspaceId, agentProfileId)
  }

  save(workspaceId: string, agentProfileId: string | null, content: string): Promise<void> {
    return this.store.save(workspaceId, agentProfileId, content)
  }

  delete(workspaceId: string, agentProfileId: string | null): Promise<void> {
    return this.store.delete(workspaceId, agentProfileId)
  }

  list(workspaceId: string): Promise<WorkflowRuleEntry[]> {
    return this.store.list(workspaceId)
  }
}
