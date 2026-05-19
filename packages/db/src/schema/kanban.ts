// Input: shared schema helpers and sqlite column builders
// Output: Kanban tables and inferred row types
// Position: Kanban persistence schema module used by Kanban and issue-agent contexts

import { index, int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { agents } from './identity'
import { createdAt, textPk, timestamps, workspaces } from './shared'

export const kanbanStatuses = sqliteTable('kanban_statuses', {
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

export const kanbanBoards = sqliteTable('kanban_boards', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  filterConfig: text('filter_config'),
  ...timestamps(),
}, table => ({
  byWorkspace: index('kanban_boards_workspace_id_idx').on(table.workspaceId),
}))

export const kanbanMilestones = sqliteTable('kanban_milestones', {
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

export const kanbanIssues = sqliteTable('kanban_issues', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  number: int('number').notNull().default(0),
  statusId: text('status_id').references(() => kanbanStatuses.id, { onDelete: 'set null' }),
  milestoneId: text('milestone_id').references(() => kanbanMilestones.id, { onDelete: 'set null' }),
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

export const kanbanIssueComments = sqliteTable('kanban_issue_comments', {
  id: textPk(),
  issueId: text('issue_id')
    .notNull()
    .references(() => kanbanIssues.id, { onDelete: 'cascade' }),
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

export const kanbanIssueRelations = sqliteTable('kanban_issue_relations', {
  id: textPk(),
  sourceIssueId: text('source_issue_id')
    .notNull()
    .references(() => kanbanIssues.id, { onDelete: 'cascade' }),
  targetIssueId: text('target_issue_id')
    .notNull()
    .references(() => kanbanIssues.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['blocks', 'duplicates', 'relates_to'] }).notNull(),
  ...createdAt(),
}, table => ({
  bySource: index('kanban_issue_relations_source_issue_id_idx').on(table.sourceIssueId),
  byTarget: index('kanban_issue_relations_target_issue_id_idx').on(table.targetIssueId),
}))

export type KanbanStatus = typeof kanbanStatuses.$inferSelect
export type KanbanBoard = typeof kanbanBoards.$inferSelect
export type KanbanMilestone = typeof kanbanMilestones.$inferSelect
export type KanbanIssue = typeof kanbanIssues.$inferSelect
export type KanbanIssueComment = typeof kanbanIssueComments.$inferSelect
export type KanbanIssueRelation = typeof kanbanIssueRelations.$inferSelect
