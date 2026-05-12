// Input: issue-agent application/query services, DB wiring, and issue-agent schema row types
// Output: IssueAgentService plus an app-owned factory for explicit runtime injection
// Position: App-level IPC adapter that composes issue-agent IPC dependencies inside the composition root

import { IpcMethod, IpcService } from '@cradle/ipc'

import { getDb } from '../../db'
import type { AgentActivity, AgentSession } from '../../db/schema'
import type { IssueAgentQueryApplicationService } from '../../issue-agent/issue-agent-query'
import { createIssueAgentQueryApplicationService } from '../../issue-agent/issue-agent-query'
import type { IssueAgentRuntime } from '../../issue-agent/issue-agent-runner'
import type { IssueDelegationApplicationService } from '../../issue-agent/issue-delegation'
import {
  createDrizzleIssueDelegationStore,
  createIssueDelegationApplicationService,
} from '../../issue-agent/issue-delegation'

export function createIssueAgentService(deps: {
  runner: IssueAgentRuntime
  delegationApp?: IssueDelegationApplicationService
  issueAgentQueryApp?: IssueAgentQueryApplicationService
}): IssueAgentService {
  return new IssueAgentService(
    deps.delegationApp
    ?? createIssueDelegationApplicationService({
        store: createDrizzleIssueDelegationStore(getDb()),
        runner: deps.runner,
      }),
    deps.issueAgentQueryApp ?? createIssueAgentQueryApplicationService(),
  )
}

export class IssueAgentService extends IpcService {
  static readonly groupName = 'issueAgent'

  constructor(
    private readonly delegationApp: IssueDelegationApplicationService,
    issueAgentQueryApp: IssueAgentQueryApplicationService = createIssueAgentQueryApplicationService(),
  ) {
    super()
    this.issueAgentQueryApp = issueAgentQueryApp
  }

  private readonly issueAgentQueryApp: IssueAgentQueryApplicationService

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
