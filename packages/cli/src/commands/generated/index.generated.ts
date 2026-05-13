// Input: generated operation command modules
// Output: registration entry for all generated CLI commands
// Position: packages/cli generated command barrel

import type { Command } from 'commander'

import { register as registerAcpAgentCancelInstall } from './acp/agent/cancel-install'
import { register as registerAcpAgentGet } from './acp/agent/get'
import { register as registerAcpAgentInstall } from './acp/agent/install'
import { register as registerAcpAgentInstallPath } from './acp/agent/install-path'
import { register as registerAcpAgentList } from './acp/agent/list'
import { register as registerAcpAgentUninstall } from './acp/agent/uninstall'
import { register as registerAcpAudit } from './acp/audit'
import { register as registerAcpRegistryDistributionTypes } from './acp/registry/distribution-types'
import { register as registerAcpRegistryList } from './acp/registry/list'
import { register as registerAgentCreate } from './agent/create'
import { register as registerAgentDelete } from './agent/delete'
import { register as registerAgentGet } from './agent/get'
import { register as registerAgentList } from './agent/list'
import { register as registerAgentUpdate } from './agent/update'
import { register as registerApprovalList } from './approval/list'
import { register as registerApprovalRespond } from './approval/respond'
import { register as registerBoardCreate } from './board/create'
import { register as registerBoardDelete } from './board/delete'
import { register as registerBoardList } from './board/list'
import { register as registerBoardUpdate } from './board/update'
import { register as registerChatCancel } from './chat/cancel'
import { register as registerChatMessages } from './chat/messages'
import { register as registerHealth } from './health'
import { register as registerIssueCommentAdd } from './issue/comment/add'
import { register as registerIssueCommentDelete } from './issue/comment/delete'
import { register as registerIssueCommentList } from './issue/comment/list'
import { register as registerIssueContextRefAdd } from './issue/context-ref/add'
import { register as registerIssueContextRefRemove } from './issue/context-ref/remove'
import { register as registerIssueCreate } from './issue/create'
import { register as registerIssueDelegate } from './issue/delegate'
import { register as registerIssueDelegation } from './issue/delegation'
import { register as registerIssueDelete } from './issue/delete'
import { register as registerIssueGet } from './issue/get'
import { register as registerIssueList } from './issue/list'
import { register as registerIssueRelationCreate } from './issue/relation/create'
import { register as registerIssueRelationDelete } from './issue/relation/delete'
import { register as registerIssueRelationList } from './issue/relation/list'
import { register as registerIssueSearch } from './issue/search'
import { register as registerIssueSessions } from './issue/sessions'
import { register as registerIssueUndelegate } from './issue/undelegate'
import { register as registerIssueUpdate } from './issue/update'
import { register as registerIssueAgentSessionActivities } from './issue-agent-session/activities'
import { register as registerIssueAgentSessionRerun } from './issue-agent-session/rerun'
import { register as registerIssueAgentSessionStop } from './issue-agent-session/stop'
import { register as registerMilestoneCreate } from './milestone/create'
import { register as registerMilestoneDelete } from './milestone/delete'
import { register as registerMilestoneList } from './milestone/list'
import { register as registerMilestoneUpdate } from './milestone/update'
import { register as registerObservabilityEvents } from './observability/events'
import { register as registerObservabilityExport } from './observability/export'
import { register as registerObservabilityIncidents } from './observability/incidents'
import { register as registerPreferencesChatGet } from './preferences/chat/get'
import { register as registerPreferencesChatSet } from './preferences/chat/set'
import { register as registerProfileDelete } from './profile/delete'
import { register as registerProfileGet } from './profile/get'
import { register as registerProfileList } from './profile/list'
import { register as registerProfileSet } from './profile/set'
import { register as registerProviderHealthCheck } from './provider/health-check'
import { register as registerProviderModels } from './provider/models'
import { register as registerSearchThreads } from './search/threads'
import { register as registerSecretDelete } from './secret/delete'
import { register as registerSecretList } from './secret/list'
import { register as registerSessionAwaitCancel } from './session/await-cancel'
import { register as registerSessionAwaitCreate } from './session/await-create'
import { register as registerSessionAwaitGet } from './session/await-get'
import { register as registerSessionAwaitList } from './session/await-list'
import { register as registerSessionAwaitSummary } from './session/await-summary'
import { register as registerSessionAwaitTrigger } from './session/await-trigger'
import { register as registerSessionCreate } from './session/create'
import { register as registerSessionDelete } from './session/delete'
import { register as registerSessionExportMarkdown } from './session/export/markdown'
import { register as registerSessionGet } from './session/get'
import { register as registerSessionLinkedIssueGet } from './session/linked-issue/get'
import { register as registerSessionLinkedIssueLink } from './session/linked-issue/link'
import { register as registerSessionLinkedIssueUnlink } from './session/linked-issue/unlink'
import { register as registerSessionList } from './session/list'
import { register as registerSessionMessages } from './session/messages'
import { register as registerSessionUpdate } from './session/update'
import { register as registerSkillCreate } from './skill/create'
import { register as registerSkillDocumentDelete } from './skill/document/delete'
import { register as registerSkillDocumentGet } from './skill/document/get'
import { register as registerSkillDocumentUpdate } from './skill/document/update'
import { register as registerSkillExport } from './skill/export'
import { register as registerSkillImport } from './skill/import'
import { register as registerSkillList } from './skill/list'
import { register as registerSkillSourceCancelFetch } from './skill/source/cancel-fetch'
import { register as registerSkillSourceFetch } from './skill/source/fetch'
import { register as registerSkillSourceImport } from './skill/source/import'
import { register as registerStatusCreate } from './status/create'
import { register as registerStatusDelete } from './status/delete'
import { register as registerStatusList } from './status/list'
import { register as registerStatusReorder } from './status/reorder'
import { register as registerStatusUpdate } from './status/update'
import { register as registerUsageCostDaily } from './usage/cost/daily'
import { register as registerUsageCostSessions } from './usage/cost/sessions'
import { register as registerUsageCostSummary } from './usage/cost/summary'
import { register as registerUsageDaily } from './usage/daily'
import { register as registerUsageSession } from './usage/session'
import { register as registerUsageStats } from './usage/stats'
import { register as registerUsageSummary } from './usage/summary'
import { register as registerWorkflowRuleDelete } from './workflow-rule/delete'
import { register as registerWorkflowRuleGet } from './workflow-rule/get'
import { register as registerWorkflowRuleList } from './workflow-rule/list'
import { register as registerWorkflowRuleSave } from './workflow-rule/save'
import { register as registerWorkspaceCreate } from './workspace/create'
import { register as registerWorkspaceDelete } from './workspace/delete'
import { register as registerWorkspaceFileRead } from './workspace/file/read'
import { register as registerWorkspaceFileWrite } from './workspace/file/write'
import { register as registerWorkspaceFiles } from './workspace/files'
import { register as registerWorkspaceGet } from './workspace/get'
import { register as registerWorkspaceGitBranchCreate } from './workspace/git/branch/create'
import { register as registerWorkspaceGitBranches } from './workspace/git/branches'
import { register as registerWorkspaceGitCheckout } from './workspace/git/checkout'
import { register as registerWorkspaceGitFetch } from './workspace/git/fetch'
import { register as registerWorkspaceGitGraph } from './workspace/git/graph'
import { register as registerWorkspaceGitStatus } from './workspace/git/status'
import { register as registerWorkspaceImport } from './workspace/import'
import { register as registerWorkspaceList } from './workspace/list'
import { register as registerWorkspacePack } from './workspace/pack'
import { register as registerWorkspaceResolve } from './workspace/resolve'
import { register as registerWorkspaceUpdate } from './workspace/update'

export function registerGeneratedCommands(program: Command): void {
  registerAcpAgentCancelInstall(program)
  registerAcpAgentGet(program)
  registerAcpAgentInstall(program)
  registerAcpAgentInstallPath(program)
  registerAcpAgentList(program)
  registerAcpAgentUninstall(program)
  registerAcpAudit(program)
  registerAcpRegistryDistributionTypes(program)
  registerAcpRegistryList(program)
  registerAgentCreate(program)
  registerAgentDelete(program)
  registerAgentGet(program)
  registerAgentList(program)
  registerAgentUpdate(program)
  registerApprovalList(program)
  registerApprovalRespond(program)
  registerBoardCreate(program)
  registerBoardDelete(program)
  registerBoardList(program)
  registerBoardUpdate(program)
  registerChatCancel(program)
  registerChatMessages(program)
  registerHealth(program)
  registerIssueCommentAdd(program)
  registerIssueCommentDelete(program)
  registerIssueCommentList(program)
  registerIssueContextRefAdd(program)
  registerIssueContextRefRemove(program)
  registerIssueCreate(program)
  registerIssueDelegate(program)
  registerIssueDelegation(program)
  registerIssueDelete(program)
  registerIssueGet(program)
  registerIssueList(program)
  registerIssueRelationCreate(program)
  registerIssueRelationDelete(program)
  registerIssueRelationList(program)
  registerIssueSearch(program)
  registerIssueSessions(program)
  registerIssueUndelegate(program)
  registerIssueUpdate(program)
  registerIssueAgentSessionActivities(program)
  registerIssueAgentSessionRerun(program)
  registerIssueAgentSessionStop(program)
  registerMilestoneCreate(program)
  registerMilestoneDelete(program)
  registerMilestoneList(program)
  registerMilestoneUpdate(program)
  registerObservabilityEvents(program)
  registerObservabilityExport(program)
  registerObservabilityIncidents(program)
  registerPreferencesChatGet(program)
  registerPreferencesChatSet(program)
  registerProfileDelete(program)
  registerProfileGet(program)
  registerProfileList(program)
  registerProfileSet(program)
  registerProviderHealthCheck(program)
  registerProviderModels(program)
  registerSearchThreads(program)
  registerSecretDelete(program)
  registerSecretList(program)
  registerSessionAwaitCancel(program)
  registerSessionAwaitCreate(program)
  registerSessionAwaitGet(program)
  registerSessionAwaitList(program)
  registerSessionAwaitSummary(program)
  registerSessionAwaitTrigger(program)
  registerSessionCreate(program)
  registerSessionDelete(program)
  registerSessionExportMarkdown(program)
  registerSessionGet(program)
  registerSessionLinkedIssueGet(program)
  registerSessionLinkedIssueLink(program)
  registerSessionLinkedIssueUnlink(program)
  registerSessionList(program)
  registerSessionMessages(program)
  registerSessionUpdate(program)
  registerSkillCreate(program)
  registerSkillDocumentDelete(program)
  registerSkillDocumentGet(program)
  registerSkillDocumentUpdate(program)
  registerSkillExport(program)
  registerSkillImport(program)
  registerSkillList(program)
  registerSkillSourceCancelFetch(program)
  registerSkillSourceFetch(program)
  registerSkillSourceImport(program)
  registerStatusCreate(program)
  registerStatusDelete(program)
  registerStatusList(program)
  registerStatusReorder(program)
  registerStatusUpdate(program)
  registerUsageCostDaily(program)
  registerUsageCostSessions(program)
  registerUsageCostSummary(program)
  registerUsageDaily(program)
  registerUsageSession(program)
  registerUsageStats(program)
  registerUsageSummary(program)
  registerWorkflowRuleDelete(program)
  registerWorkflowRuleGet(program)
  registerWorkflowRuleList(program)
  registerWorkflowRuleSave(program)
  registerWorkspaceCreate(program)
  registerWorkspaceDelete(program)
  registerWorkspaceFileRead(program)
  registerWorkspaceFileWrite(program)
  registerWorkspaceFiles(program)
  registerWorkspaceGet(program)
  registerWorkspaceGitBranchCreate(program)
  registerWorkspaceGitBranches(program)
  registerWorkspaceGitCheckout(program)
  registerWorkspaceGitFetch(program)
  registerWorkspaceGitGraph(program)
  registerWorkspaceGitStatus(program)
  registerWorkspaceImport(program)
  registerWorkspaceList(program)
  registerWorkspacePack(program)
  registerWorkspaceResolve(program)
  registerWorkspaceUpdate(program)
}
