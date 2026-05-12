import { Elysia, t } from 'elysia'

import { KanbanModel } from './model'
import * as Kanban from './service'

export const kanban = new Elysia({
  prefix: '/kanban',
  detail: { tags: ['kanban'] },
})
  // ── boards ──
  .get('/boards', ({ query }) => Kanban.listBoards(query.workspaceId), {
    detail: { summary: 'List boards' },
    query: KanbanModel.workspaceIdQuery,
    response: { 200: t.Array(KanbanModel.board) },
  })
  .post('/boards', ({ body }) => Kanban.createBoard(body), {
    detail: { summary: 'Create board' },
    body: KanbanModel.createBoardBody,
    response: { 200: KanbanModel.board },
  })
  .delete('/boards/:id', ({ params }) => {
    Kanban.deleteBoard(params.id)
    return { ok: true as const }
  }, {
    detail: { summary: 'Delete board' },
    params: KanbanModel.idParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .patch('/boards/:id', ({ params, body }) => Kanban.updateBoard(params.id, body), {
    detail: { summary: 'Update board' },
    params: KanbanModel.idParams,
    body: KanbanModel.updateBoardBody,
    response: { 200: KanbanModel.board },
  })

  // ── statuses ──
  .get('/statuses', ({ query }) => Kanban.listStatuses(query.workspaceId), {
    detail: { summary: 'List statuses' },
    query: KanbanModel.requiredWorkspaceIdQuery,
    response: { 200: t.Array(KanbanModel.status) },
  })
  .post('/statuses', ({ body }) => Kanban.createStatus(body), {
    detail: { summary: 'Create status' },
    body: KanbanModel.createStatusBody,
    response: { 200: KanbanModel.status },
  })
  .post('/statuses/reorder', ({ body }) => {
    Kanban.reorderStatuses(body.workspaceId, body.orderedIds)
    return { ok: true as const }
  }, {
    detail: { summary: 'Reorder statuses' },
    body: KanbanModel.reorderStatusesBody,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .patch('/statuses/:id', ({ params, body }) => Kanban.updateStatus(params.id, body), {
    detail: { summary: 'Update status' },
    params: KanbanModel.idParams,
    body: KanbanModel.updateStatusBody,
    response: { 200: KanbanModel.status },
  })
  .delete('/statuses/:id', ({ params }) => {
    Kanban.deleteStatus(params.id)
    return { ok: true as const }
  }, {
    detail: { summary: 'Delete status' },
    params: KanbanModel.idParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })

  // ── milestones ──
  .get('/milestones', ({ query }) => Kanban.listMilestones(query.workspaceId), {
    detail: { summary: 'List milestones' },
    query: KanbanModel.requiredWorkspaceIdQuery,
    response: { 200: t.Array(KanbanModel.milestone) },
  })
  .post('/milestones', ({ body }) => Kanban.createMilestone(body), {
    detail: { summary: 'Create milestone' },
    body: KanbanModel.createMilestoneBody,
    response: { 200: KanbanModel.milestone },
  })
  .patch('/milestones/:id', ({ params, body }) => Kanban.updateMilestone(params.id, body), {
    detail: { summary: 'Update milestone' },
    params: KanbanModel.idParams,
    body: KanbanModel.updateMilestoneBody,
    response: { 200: KanbanModel.milestone },
  })
  .delete('/milestones/:id', ({ params }) => {
    Kanban.deleteMilestone(params.id)
    return { ok: true as const }
  }, {
    detail: { summary: 'Delete milestone' },
    params: KanbanModel.idParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })

  // ── issues ──
  .get('/issues/search', ({ query }) => Kanban.searchIssues(query.q, Number(query.limit) || 20), {
    detail: { summary: 'Search issues' },
    query: t.Object({ q: t.String(), limit: t.Optional(t.String()) }),
    response: { 200: t.Array(KanbanModel.issue) },
  })
  .get('/issues', ({ query }) => Kanban.listIssues({
    workspaceId: query.workspaceId,
    milestoneId: query.milestoneId,
    parentIssueId: query.parentIssueId,
    priority: query.priority,
    labels: normalizeLabels(query.labels),
    statusId: query.statusId,
  }), {
    detail: { summary: 'List issues' },
    query: KanbanModel.listIssuesQuery,
    response: { 200: t.Array(KanbanModel.issue) },
  })
  .get('/issues/:id', ({ params }) => Kanban.getIssue(params.id), {
    detail: { summary: 'Get issue' },
    params: KanbanModel.idParams,
    response: { 200: KanbanModel.issue },
  })
  .post('/issues', ({ body }) => Kanban.createIssue(body), {
    detail: { summary: 'Create issue' },
    body: KanbanModel.createIssueBody,
    response: { 200: KanbanModel.issue },
  })
  .patch('/issues/:id', ({ params, body }) => Kanban.updateIssue(params.id, body), {
    detail: { summary: 'Update issue' },
    params: KanbanModel.idParams,
    body: KanbanModel.updateIssueBody,
    response: { 200: KanbanModel.issue },
  })
  .delete('/issues/:id', ({ params }) => {
    Kanban.deleteIssue(params.id)
    return { ok: true as const }
  }, {
    detail: { summary: 'Delete issue' },
    params: KanbanModel.idParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })

  // ── comments ──
  .get('/issues/:id/comments', ({ params }) => Kanban.listComments(params.id), {
    detail: { summary: 'List comments' },
    params: KanbanModel.idParams,
    response: { 200: t.Array(KanbanModel.issueComment) },
  })
  .post('/issues/:id/comments', ({ params, body }) => Kanban.addComment({ issueId: params.id, content: body.content }), {
    detail: { summary: 'Add comment' },
    params: KanbanModel.idParams,
    body: KanbanModel.addCommentBody,
    response: { 200: KanbanModel.issueComment },
  })
  .delete('/comments/:id', ({ params }) => {
    Kanban.deleteComment(params.id)
    return { ok: true as const }
  }, {
    detail: { summary: 'Delete comment' },
    params: KanbanModel.idParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })

  // ── relations ──
  .get('/issues/:id/relations', ({ params }) => Kanban.listRelations(params.id), {
    detail: { summary: 'List issue relations' },
    params: KanbanModel.idParams,
    response: { 200: t.Array(KanbanModel.issueRelation) },
  })
  .post('/relations', ({ body }) => Kanban.createRelation(body), {
    detail: { summary: 'Create relation' },
    body: KanbanModel.createRelationBody,
    response: { 200: KanbanModel.issueRelation },
  })
  .delete('/relations/:id', ({ params }) => {
    Kanban.deleteRelation(params.id)
    return { ok: true as const }
  }, {
    detail: { summary: 'Delete relation' },
    params: KanbanModel.idParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })

  // ── context refs ──
  .post('/issues/:id/context-refs', ({ params, body }) => Kanban.addContextRef(params.id, body.ref), {
    detail: { summary: 'Add context ref' },
    params: KanbanModel.idParams,
    body: KanbanModel.addContextRefBody,
    response: { 200: KanbanModel.issue },
  })
  .delete('/issues/:id/context-refs/:index', ({ params }) => Kanban.removeContextRef(params.id, Number(params.index)), {
    detail: { summary: 'Remove context ref' },
    params: KanbanModel.contextRefIndexParams,
    response: { 200: KanbanModel.issue },
  })

function normalizeLabels(value: string[] | string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined
  }
  if (Array.isArray(value)) {
    return value.filter(item => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())
  }
  return value.split(',').map(item => item.trim()).filter(item => item.length > 0)
}
