// Input: shared schema helpers, workspace and identity tables, and sqlite column builders
// Output: Issue-owned workflow, issue, comment, and relation tables plus inferred row types
// Position: Issue persistence schema module scoped by workspace and consumed by Issue, issue-agent, chat, and Kanban views

import { index, int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { agents } from './identity'
import { createdAt, textPk, timestamps, workspaces } from './shared'

export const issueStatuses = sqliteTable('kanban_statuses', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color'),
  category: text('category', { enum: ['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'] }).notNull().default('unstarted'),
  order: int('order').notNull().default(0),
  ...createdAt(),
}, table => ({
  byWorkspace: index('kanban_statuses_workspace_id_idx').on(table.workspaceId),
}))

export const issueMilestones = sqliteTable('kanban_milestones', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  dueDate: int('due_date'),
  status: text('status', { enum: ['open', 'closed'] }).notNull().default('open'),
  ...timestamps(),
}, table => ({
  byWorkspace: index('kanban_milestones_workspace_id_idx').on(table.workspaceId),
}))

export const issues = sqliteTable('kanban_issues', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  number: int('number').notNull().default(0),
  statusId: text('status_id').references(() => issueStatuses.id, { onDelete: 'set null' }),
  milestoneId: text('milestone_id').references(() => issueMilestones.id, { onDelete: 'set null' }),
  parentIssueId: text('parent_issue_id'),
  title: text('title').notNull(),
  description: text('description'),
  priority: text('priority', {
    enum: ['none', 'low', 'medium', 'high', 'urgent'],
  }).notNull().default('none'),
  labels: text('labels').notNull().default('[]'),
  assigneeKind: text('assignee_kind'),
  assigneeId: text('assignee_id'),
  createdByKind: text('created_by_kind', { enum: ['user', 'agent', 'system'] }).notNull().default('user'),
  createdById: text('created_by_id').notNull().default('__self__'),
  delegateAgentId: text('delegate_agent_id').references(() => agents.id, { onDelete: 'set null' }),
  delegateAgentProfileId: text('delegate_agent_profile_id'),
  contextRefs: text('context_refs').notNull().default('[]'),
  order: int('order').notNull().default(0),
  ...timestamps(),
}, table => ({
  byWorkspace: index('kanban_issues_workspace_id_idx').on(table.workspaceId),
  byStatus: index('kanban_issues_status_id_idx').on(table.statusId),
  byMilestone: index('kanban_issues_milestone_id_idx').on(table.milestoneId),
  byParent: index('kanban_issues_parent_issue_id_idx').on(table.parentIssueId),
  byDelegateAgent: index('kanban_issues_delegate_agent_id_idx').on(table.delegateAgentId),
  byDelegateAgentProfile: index('kanban_issues_delegate_agent_profile_id_idx').on(table.delegateAgentProfileId),
}))

export const issueComments = sqliteTable('kanban_issue_comments', {
  id: textPk(),
  issueId: text('issue_id')
    .notNull()
    .references(() => issues.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  authorKind: text('author_kind', {
    enum: ['user', 'agent', 'system', 'system.delegated', 'system.undelegated'],
  }).notNull().default('user'),
  authorId: text('author_id'),
  agentActivityId: text('agent_activity_id'),
  ...createdAt(),
}, table => ({
  byIssue: index('kanban_issue_comments_issue_id_idx').on(table.issueId),
}))

export const issueRelations = sqliteTable('kanban_issue_relations', {
  id: textPk(),
  sourceIssueId: text('source_issue_id')
    .notNull()
    .references(() => issues.id, { onDelete: 'cascade' }),
  targetIssueId: text('target_issue_id')
    .notNull()
    .references(() => issues.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['blocks', 'duplicates', 'relates_to'] }).notNull(),
  ...createdAt(),
}, table => ({
  bySource: index('kanban_issue_relations_source_issue_id_idx').on(table.sourceIssueId),
  byTarget: index('kanban_issue_relations_target_issue_id_idx').on(table.targetIssueId),
}))

export type IssueStatus = typeof issueStatuses.$inferSelect
export type IssueMilestone = typeof issueMilestones.$inferSelect
export type Issue = typeof issues.$inferSelect
export type IssueComment = typeof issueComments.$inferSelect
export type IssueRelation = typeof issueRelations.$inferSelect

export {
  issueComments as kanbanIssueComments,
  issueMilestones as kanbanMilestones,
  issueRelations as kanbanIssueRelations,
  issues as kanbanIssues,
  issueStatuses as kanbanStatuses,
}

export type KanbanStatus = IssueStatus
export type KanbanMilestone = IssueMilestone
export type KanbanIssue = Issue
export type KanbanIssueComment = IssueComment
export type KanbanIssueRelation = IssueRelation
