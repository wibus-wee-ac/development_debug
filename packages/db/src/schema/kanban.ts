// Input: shared schema helpers and sqlite column builders
// Output: Kanban tables and inferred row types
// Position: Kanban persistence schema module used by Kanban and issue-agent contexts

import { int, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
})

export const kanbanBoards = sqliteTable('kanban_boards', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  filterConfig: text('filter_config'),
  ...timestamps(),
})

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
})

export const kanbanIssues = sqliteTable('kanban_issues', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
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
  delegateAgentProfileId: text('delegate_agent_profile_id'),
  contextRefs: text('context_refs').notNull().default('[]'),
  order: int('order').notNull().default(0),
  ...timestamps(),
})

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
})

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
})

export type KanbanStatus = typeof kanbanStatuses.$inferSelect
export type KanbanBoard = typeof kanbanBoards.$inferSelect
export type KanbanMilestone = typeof kanbanMilestones.$inferSelect
export type KanbanIssue = typeof kanbanIssues.$inferSelect
export type KanbanIssueComment = typeof kanbanIssueComments.$inferSelect
export type KanbanIssueRelation = typeof kanbanIssueRelations.$inferSelect
