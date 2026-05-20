// Input: Elysia TypeBox schema builders
// Output: Issue module request and response schemas for HTTP, OpenAPI, and CLI generation
// Position: Issue module contract surface consumed by route handlers and generated clients

import { t } from 'elysia'

const priorityEnum = t.Union([
  t.Literal('none'),
  t.Literal('low'),
  t.Literal('medium'),
  t.Literal('high'),
  t.Literal('urgent'),
])

const categoryEnum = t.Union([
  t.Literal('triage'),
  t.Literal('backlog'),
  t.Literal('unstarted'),
  t.Literal('started'),
  t.Literal('completed'),
  t.Literal('canceled'),
])

export const IssueModel = {
  status: t.Object({
    id: t.String(),
    workspaceId: t.String(),
    name: t.String(),
    color: t.Nullable(t.String()),
    category: t.String(),
    order: t.Number(),
    createdAt: t.Number(),
  }),

  milestone: t.Object({
    id: t.String(),
    workspaceId: t.String(),
    title: t.String(),
    description: t.Nullable(t.String()),
    dueDate: t.Nullable(t.Number()),
    status: t.Union([t.Literal('open'), t.Literal('closed')]),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  issue: t.Object({
    id: t.String(),
    workspaceId: t.String(),
    number: t.Number(),
    statusId: t.Nullable(t.String()),
    milestoneId: t.Nullable(t.String()),
    parentIssueId: t.Nullable(t.String()),
    title: t.String(),
    description: t.Nullable(t.String()),
    priority: priorityEnum,
    labels: t.String(),
    assigneeKind: t.Nullable(t.String()),
    assigneeId: t.Nullable(t.String()),
    createdByKind: t.Union([t.Literal('user'), t.Literal('agent'), t.Literal('system')]),
    createdById: t.String(),
    delegateAgentId: t.Nullable(t.String()),
    delegateAgentProfileId: t.Nullable(t.String()),
    contextRefs: t.String(),
    order: t.Number(),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  commentAuthor: t.Object({
    kind: t.Union([t.Literal('user'), t.Literal('agent'), t.Literal('system')]),
    id: t.Nullable(t.String()),
    displayName: t.String(),
    avatarUrl: t.Nullable(t.String()),
    label: t.Nullable(t.String()),
  }),

  comment: t.Object({
    id: t.String(),
    issueId: t.String(),
    content: t.String(),
    authorKind: t.Union([
      t.Literal('user'),
      t.Literal('agent'),
      t.Literal('system'),
      t.Literal('system.delegated'),
      t.Literal('system.undelegated'),
    ]),
    authorId: t.Nullable(t.String()),
    author: t.Object({
      kind: t.Union([t.Literal('user'), t.Literal('agent'), t.Literal('system')]),
      id: t.Nullable(t.String()),
      displayName: t.String(),
      avatarUrl: t.Nullable(t.String()),
      label: t.Nullable(t.String()),
    }),
    agentActivityId: t.Nullable(t.String()),
    createdAt: t.Number(),
  }),

  relation: t.Object({
    id: t.String(),
    sourceIssueId: t.String(),
    targetIssueId: t.String(),
    type: t.Union([t.Literal('blocks'), t.Literal('duplicates'), t.Literal('relates_to')]),
    createdAt: t.Number(),
  }),

  requiredWorkspaceIdQuery: t.Object({
    workspaceId: t.String({ minLength: 1 }),
  }),

  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }),

  createStatusBody: t.Object({
    workspaceId: t.String({ minLength: 1 }),
    name: t.String({ minLength: 1 }),
    color: t.Optional(t.Nullable(t.String())),
    category: t.Optional(categoryEnum),
  }),

  updateStatusBody: t.Object({
    name: t.Optional(t.String({ minLength: 1 })),
    color: t.Optional(t.Nullable(t.String())),
  }),

  reorderStatusesBody: t.Object({
    workspaceId: t.String({ minLength: 1 }),
    orderedIds: t.Array(t.String()),
  }),

  createIssueBody: t.Object({
    workspaceId: t.String({ minLength: 1 }),
    title: t.String({ minLength: 1 }),
    description: t.Optional(t.Nullable(t.String())),
    priority: t.Optional(priorityEnum),
    labels: t.Optional(t.Array(t.String())),
    milestoneId: t.Optional(t.Nullable(t.String())),
    parentIssueId: t.Optional(t.Nullable(t.String())),
    statusId: t.Optional(t.Nullable(t.String())),
  }),

  updateIssueBody: t.Object({
    title: t.Optional(t.String({ minLength: 1 })),
    description: t.Optional(t.Nullable(t.String())),
    priority: t.Optional(priorityEnum),
    labels: t.Optional(t.Array(t.String())),
    milestoneId: t.Optional(t.Nullable(t.String())),
    parentIssueId: t.Optional(t.Nullable(t.String())),
    statusId: t.Optional(t.Nullable(t.String())),
    assigneeKind: t.Optional(t.Nullable(t.String())),
    assigneeId: t.Optional(t.Nullable(t.String())),
    order: t.Optional(t.Number()),
  }),

  bulkUpdateBody: t.Object({
    issueIds: t.Array(t.String()),
    update: t.Object({
      statusId: t.Optional(t.Nullable(t.String())),
      priority: t.Optional(priorityEnum),
      labels: t.Optional(t.String()),
      milestoneId: t.Optional(t.Nullable(t.String())),
      assigneeKind: t.Optional(t.Nullable(t.String())),
      assigneeId: t.Optional(t.Nullable(t.String())),
    }),
  }),

  addCommentBody: t.Object({
    content: t.String({ minLength: 1 }),
  }),

  createMilestoneBody: t.Object({
    workspaceId: t.String({ minLength: 1 }),
    title: t.String({ minLength: 1 }),
    description: t.Optional(t.Nullable(t.String())),
    dueDate: t.Optional(t.Nullable(t.Number())),
    status: t.Optional(t.Union([t.Literal('open'), t.Literal('closed')])),
  }),

  updateMilestoneBody: t.Object({
    title: t.Optional(t.String({ minLength: 1 })),
    description: t.Optional(t.Nullable(t.String())),
    dueDate: t.Optional(t.Nullable(t.Number())),
    status: t.Optional(t.Union([t.Literal('open'), t.Literal('closed')])),
  }),

  createRelationBody: t.Object({
    sourceIssueId: t.String({ minLength: 1 }),
    targetIssueId: t.String({ minLength: 1 }),
    type: t.Union([t.Literal('blocks'), t.Literal('duplicates'), t.Literal('relates_to')]),
  }),

  addContextRefBody: t.Object({
    ref: t.String({ minLength: 1 }),
  }),

  contextRefIndexParams: t.Object({
    id: t.String({ minLength: 1 }),
    index: t.String(),
  }),

  linkedIssueResponse: t.Object({
    issueId: t.Nullable(t.String()),
  }),

  linkIssueBody: t.Object({
    issueId: t.String({ minLength: 1 }),
  }),

  listIssuesQuery: t.Object({
    workspaceId: t.String({ minLength: 1 }),
    milestoneId: t.Optional(t.String()),
    parentIssueId: t.Optional(t.String()),
    priority: t.Optional(t.String()),
    labels: t.Optional(t.Union([t.Array(t.String()), t.String()])),
    statusId: t.Optional(t.String()),
  }),
}
