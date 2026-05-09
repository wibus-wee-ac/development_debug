// Input: issue-agent controller, service, and store
// Output: issue-agent module registration
// Position: apps/server/src/modules/issue-agent/issue-agent.module.ts

import { Module } from '@tsuki-hono/common'

import { ChatRuntimeModule } from '../chat-runtime/chat-runtime.module'
import { SessionModule } from '../session/session.module'
import { WorkflowRulesModule } from '../workflow-rules/workflow-rules.module'
import { IssueAgentService } from './issue-agent.service'
import { IssueAgentStore } from './issue-agent.store'
import { IssueAgentSessionController } from './issue-agent-session.controller'
import { KanbanIssueDelegationController } from './kanban-issue-delegation.controller'

@Module({
  imports: [ChatRuntimeModule, SessionModule, WorkflowRulesModule],
  controllers: [KanbanIssueDelegationController, IssueAgentSessionController],
  providers: [IssueAgentService, IssueAgentStore],
})
export class IssueAgentModule {}
