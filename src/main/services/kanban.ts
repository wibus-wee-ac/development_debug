// Input: Kanban application services and Kanban schema row types
// Output: KanbanService — thin IPC facade for Kanban queries, commands, and delegation workflows
// Position: Main-process IPC adapter for the Kanban feature

import { IpcMethod, IpcService } from '@cradle/ipc'

import { createIssueDelegationApplicationService } from '../application/issue-delegation-application'
import {
  createKanbanQueryApplicationService,
  type KanbanQueryApplicationService,
} from '../application/kanban-query-application'
import {
  createKanbanWriteApplicationService,
  type KanbanWriteApplicationService,
} from '../application/kanban-write-application'
import type {
  AgentActivity,
  AgentSession,
  KanbanBoard,
  KanbanIssue,
  KanbanIssueComment,
  KanbanIssueRelation,
  KanbanMilestone,
  KanbanStatus,
} from '../db/schema'
import {
  type IssueDelegationApplicationService,
} from '../application/issue-delegation-application'

export class KanbanService extends IpcService {
  static readonly groupName = 'kanban'
  private readonly delegationApp: IssueDelegationApplicationService
  private readonly kanbanQueryApp: KanbanQueryApplicationService
  private readonly kanbanWriteApp: KanbanWriteApplicationService

  constructor(
    delegationApp: IssueDelegationApplicationService = createIssueDelegationApplicationService(),
    kanbanQueryApp: KanbanQueryApplicationService = createKanbanQueryApplicationService(),
    kanbanWriteApp: KanbanWriteApplicationService = createKanbanWriteApplicationService(),
  ) {
    super()
    this.delegationApp = delegationApp
    this.kanbanQueryApp = kanbanQueryApp
    this.kanbanWriteApp = kanbanWriteApp
  }

  // ── Status ────────────────────────────────────────────────────────────────

  @IpcMethod()
  listStatuses(workspaceId: string): KanbanStatus[] {
    return this.kanbanQueryApp.listStatuses(workspaceId)
  }

  @IpcMethod()
  createStatus(input: {
    workspaceId: string
    name: string
    color?: string | null
  }): KanbanStatus {
    return this.kanbanWriteApp.createStatus(input)
  }

  @IpcMethod()
  updateStatus(id: string, patch: {
    name?: string
    color?: string | null
  }): KanbanStatus {
    return this.kanbanWriteApp.updateStatus(id, patch)
  }

  @IpcMethod()
  reorderStatuses(workspaceId: string, orderedIds: string[]): void {
    this.kanbanWriteApp.reorderStatuses(workspaceId, orderedIds)
  }

  @IpcMethod()
  deleteStatus(id: string): void {
    this.kanbanWriteApp.deleteStatus(id)
  }

  // ── Board ─────────────────────────────────────────────────────────────────

  @IpcMethod()
  listBoards(workspaceId?: string): KanbanBoard[] {
    return this.kanbanQueryApp.listBoards(workspaceId)
  }

  @IpcMethod()
  createBoard(input: {
    workspaceId: string
    name: string
    filterConfig?: string | null
  }): KanbanBoard {
    return this.kanbanWriteApp.createBoard(input)
  }

  @IpcMethod()
  updateBoard(id: string, patch: {
    name?: string
    filterConfig?: string | null
  }): KanbanBoard {
    return this.kanbanWriteApp.updateBoard(id, patch)
  }

  @IpcMethod()
  deleteBoard(id: string): void {
    this.kanbanWriteApp.deleteBoard(id)
  }

  // ── Milestone ─────────────────────────────────────────────────────────────

  @IpcMethod()
  listMilestones(workspaceId: string): KanbanMilestone[] {
    return this.kanbanQueryApp.listMilestones(workspaceId)
  }

  @IpcMethod()
  createMilestone(input: {
    workspaceId: string
    title: string
    description?: string | null
    dueDate?: number | null
  }): KanbanMilestone {
    return this.kanbanWriteApp.createMilestone(input)
  }

  @IpcMethod()
  updateMilestone(id: string, patch: {
    title?: string
    description?: string | null
    dueDate?: number | null
    status?: 'open' | 'closed'
  }): KanbanMilestone {
    return this.kanbanWriteApp.updateMilestone(id, patch)
  }

  @IpcMethod()
  deleteMilestone(id: string): void {
    this.kanbanWriteApp.deleteMilestone(id)
  }

  // ── Issue ─────────────────────────────────────────────────────────────────

  @IpcMethod()
  listIssues(params: {
    workspaceId: string
    milestoneId?: string | null
    parentIssueId?: string | null
    priority?: string | null
    labels?: string[] | null
    statusId?: string | null
  }): KanbanIssue[] {
    return this.kanbanQueryApp.listIssues(params)
  }

  @IpcMethod()
  searchIssues(query: string, limit = 20): KanbanIssue[] {
    return this.kanbanQueryApp.searchIssues(query, limit)
  }

  @IpcMethod()
  getIssue(id: string): KanbanIssue | undefined {
    return this.kanbanQueryApp.getIssue(id)
  }

  @IpcMethod()
  createIssue(input: {
    workspaceId: string
    title: string
    description?: string | null
    priority?: KanbanIssue['priority']
    labels?: string[]
    milestoneId?: string | null
    parentIssueId?: string | null
    statusId?: string | null
  }): KanbanIssue {
    return this.kanbanWriteApp.createIssue(input)
  }

  @IpcMethod()
  updateIssue(id: string, patch: Partial<{
    title: string
    description: string | null
    priority: KanbanIssue['priority']
    labels: string[]
    milestoneId: string | null
    parentIssueId: string | null
    statusId: string | null
    assigneeKind: string | null
    assigneeId: string | null
  }>): KanbanIssue {
    return this.kanbanWriteApp.updateIssue(id, patch)
  }

  @IpcMethod()
  moveIssue(id: string, statusId: string | null): KanbanIssue {
    return this.kanbanWriteApp.moveIssue(id, statusId)
  }

  @IpcMethod()
  deleteIssue(id: string): void {
    this.kanbanWriteApp.deleteIssue(id)
  }

  // ── Comment ───────────────────────────────────────────────────────────────

  @IpcMethod()
  listComments(issueId: string): KanbanIssueComment[] {
    return this.kanbanQueryApp.listComments(issueId)
  }

  @IpcMethod()
  addComment(input: {
    issueId: string
    content: string
    authorKind?: KanbanIssueComment['authorKind']
    authorId?: string | null
  }): KanbanIssueComment {
    return this.kanbanWriteApp.addComment(input)
  }

  @IpcMethod()
  deleteComment(id: string): void {
    this.kanbanWriteApp.deleteComment(id)
  }

  // ── Relation ──────────────────────────────────────────────────────────────

  @IpcMethod()
  listRelations(issueId: string): KanbanIssueRelation[] {
    return this.kanbanQueryApp.listRelations(issueId)
  }

  @IpcMethod()
  addRelation(input: {
    sourceIssueId: string
    targetIssueId: string
    type: 'blocks' | 'duplicates' | 'relates_to'
  }): KanbanIssueRelation {
    return this.kanbanWriteApp.addRelation(input)
  }

  @IpcMethod()
  deleteRelation(id: string): void {
    this.kanbanWriteApp.deleteRelation(id)
  }

  // ── Delegation ───────────────────────────────────────────────────────────

  @IpcMethod()
  async delegateIssue(issueId: string, agentProfileId: string, _agentId?: string): Promise<AgentSession> {
    return this.delegationApp.delegateIssue({ issueId, agentProfileId })
  }

  /**
   * Trigger agent execution for a delegated issue.
   * Called by the renderer after delegateIssue succeeds.
   */
  @IpcMethod()
  async runDelegatedIssue(issueId: string, agentSessionId: string, agentProfileId: string, agentId?: string): Promise<void> {
    await this.delegationApp.runDelegatedIssue({ issueId, agentSessionId, agentProfileId, agentId })
  }

  /**
   * Stop an agent session that's currently executing.
   */
  @IpcMethod()
  async stopAgentSession(agentSessionId: string): Promise<void> {
    await this.delegationApp.stopAgentSession(agentSessionId)
  }

  @IpcMethod()
  async undelegateIssue(issueId: string): Promise<void> {
    await this.delegationApp.undelegateIssue(issueId)
  }

  // ── Agent Sessions ──────────────────────────────────────────────────────

  @IpcMethod()
  getAgentSessions(issueId: string): AgentSession[] {
    return this.kanbanQueryApp.getAgentSessions(issueId)
  }

  // ── Agent Activities ────────────────────────────────────────────────────

  @IpcMethod()
  getAgentActivities(agentSessionId: string): AgentActivity[] {
    return this.kanbanQueryApp.getAgentActivities(agentSessionId)
  }

  // ── Context Refs ────────────────────────────────────────────────────────

  @IpcMethod()
  updateContextRefs(issueId: string, refs: string): void {
    this.kanbanWriteApp.updateContextRefs(issueId, refs)
  }

  @IpcMethod()
  addContextRef(issueId: string, ref: string): void {
    this.kanbanWriteApp.addContextRef(issueId, ref)
  }

  @IpcMethod()
  removeContextRef(issueId: string, index: number): void {
    this.kanbanWriteApp.removeContextRef(issueId, index)
  }

  // ── Session ↔ Issue Link ────────────────────────────────────────────────

  @IpcMethod()
  getLinkedIssue(chatSessionId: string): {
    issue: KanbanIssue
    status: KanbanStatus | null
    agentSession: AgentSession | null
  } | null {
    return this.kanbanQueryApp.getLinkedIssue(chatSessionId)
  }

  @IpcMethod()
  linkIssueToSession(chatSessionId: string, issueId: string): void {
    this.kanbanWriteApp.linkIssueToSession(chatSessionId, issueId)
  }

  @IpcMethod()
  unlinkIssueFromSession(chatSessionId: string): void {
    this.kanbanWriteApp.unlinkIssueFromSession(chatSessionId)
  }
}
