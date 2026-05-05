// Input: issue-agent application/query services and issue-agent schema row types
// Output: IssueAgentService — thin IPC facade for delegation commands and agent-session queries
// Position: App-level IPC adapter for the issue-agent feature

import { IpcMethod, IpcService } from '@cradle/ipc'

import type { AgentActivity, AgentSession } from '../../db/schema'
import type { IssueAgentQueryApplicationService } from '../../features/issue-agent/issue-agent-query'
import { createIssueAgentQueryApplicationService } from '../../features/issue-agent/issue-agent-query'
import type { IssueDelegationApplicationService } from '../../features/issue-agent/issue-delegation'
import { createIssueDelegationApplicationService } from '../../features/issue-agent/issue-delegation'

export class IssueAgentService extends IpcService {
  static readonly groupName = 'issueAgent'
  private readonly delegationApp: IssueDelegationApplicationService
  private readonly issueAgentQueryApp: IssueAgentQueryApplicationService

  constructor(
    delegationApp: IssueDelegationApplicationService = createIssueDelegationApplicationService(),
    issueAgentQueryApp: IssueAgentQueryApplicationService = createIssueAgentQueryApplicationService(),
  ) {
    super()
    this.delegationApp = delegationApp
    this.issueAgentQueryApp = issueAgentQueryApp
  }

  @IpcMethod()
  async delegateIssue(issueId: string, agentProfileId: string, _agentId?: string): Promise<AgentSession> {
    return this.delegationApp.delegateIssue({ issueId, agentProfileId })
  }

  @IpcMethod()
  async runDelegatedIssue(issueId: string, agentSessionId: string, agentProfileId: string, agentId?: string): Promise<void> {
    await this.delegationApp.runDelegatedIssue({ issueId, agentSessionId, agentProfileId, agentId })
  }

  @IpcMethod()
  async stopAgentSession(agentSessionId: string): Promise<void> {
    await this.delegationApp.stopAgentSession(agentSessionId)
  }

  @IpcMethod()
  async undelegateIssue(issueId: string): Promise<void> {
    await this.delegationApp.undelegateIssue(issueId)
  }

  @IpcMethod()
  getAgentSessions(issueId: string): AgentSession[] {
    return this.issueAgentQueryApp.listAgentSessions(issueId)
  }

  @IpcMethod()
  getAgentActivities(agentSessionId: string): AgentActivity[] {
    return this.issueAgentQueryApp.listAgentActivities(agentSessionId)
  }
}
