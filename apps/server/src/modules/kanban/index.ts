import { Elysia, t } from 'elysia'

import { KanbanModel } from './model'
import * as Kanban from './service'

export const kanban = new Elysia({
  prefix: '/kanban',
  detail: { tags: ['kanban'] },
})
  // ── boards ──
  .get('/boards', ({ query }) => Kanban.listBoards(query.workspaceId), {
    detail: {
      'summary': 'List boards',
      'x-cradle-cli': {
        command: ['board', 'list'],
      },
    },
    query: KanbanModel.workspaceIdQuery,
    response: { 200: t.Array(KanbanModel.board) },
  })
  .post('/boards', ({ body }) => Kanban.createBoard(body), {
    detail: {
      'summary': 'Create board',
      'x-cradle-cli': {
        command: ['board', 'create'],
      },
    },
    body: KanbanModel.createBoardBody,
    response: { 200: KanbanModel.board },
  })
  .delete('/boards/:id', ({ params }) => {
    Kanban.deleteBoard(params.id)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Delete board',
      'x-cradle-cli': {
        command: ['board', 'delete'],
      },
    },
    params: KanbanModel.idParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .patch('/boards/:id', ({ params, body }) => Kanban.updateBoard(params.id, body), {
    detail: {
      'summary': 'Update board',
      'x-cradle-cli': {
        command: ['board', 'update'],
      },
    },
    params: KanbanModel.idParams,
    body: KanbanModel.updateBoardBody,
    response: { 200: KanbanModel.board },
  })

  // ── statuses ──
  .get('/statuses', ({ query }) => Kanban.listStatuses(query.workspaceId), {
    detail: {
      'summary': 'List statuses',
      'x-cradle-cli': {
        command: ['status', 'list'],
      },
    },
    query: KanbanModel.requiredWorkspaceIdQuery,
    response: { 200: t.Array(KanbanModel.status) },
  })
  .post('/statuses', ({ body }) => Kanban.createStatus(body), {
    detail: {
      'summary': 'Create status',
      'x-cradle-cli': {
        command: ['status', 'create'],
      },
    },
    body: KanbanModel.createStatusBody,
    response: { 200: KanbanModel.status },
  })
  .post('/statuses/reorder', ({ body }) => {
    Kanban.reorderStatuses(body.workspaceId, body.orderedIds)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Reorder statuses',
      'x-cradle-cli': {
        command: ['status', 'reorder'],
      },
    },
    body: KanbanModel.reorderStatusesBody,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .patch('/statuses/:id', ({ params, body }) => Kanban.updateStatus(params.id, body), {
    detail: {
      'summary': 'Update status',
      'x-cradle-cli': {
        command: ['status', 'update'],
      },
    },
    params: KanbanModel.idParams,
    body: KanbanModel.updateStatusBody,
    response: { 200: KanbanModel.status },
  })
  .delete('/statuses/:id', ({ params }) => {
    Kanban.deleteStatus(params.id)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Delete status',
      'x-cradle-cli': {
        command: ['status', 'delete'],
      },
    },
    params: KanbanModel.idParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })

  // ── milestones ──
  .get('/milestones', ({ query }) => Kanban.listMilestones(query.workspaceId), {
    detail: {
      'summary': 'List milestones',
      'x-cradle-cli': {
        command: ['milestone', 'list'],
      },
    },
    query: KanbanModel.requiredWorkspaceIdQuery,
    response: { 200: t.Array(KanbanModel.milestone) },
  })
  .post('/milestones', ({ body }) => Kanban.createMilestone(body), {
    detail: {
      'summary': 'Create milestone',
      'x-cradle-cli': {
        command: ['milestone', 'create'],
      },
    },
    body: KanbanModel.createMilestoneBody,
    response: { 200: KanbanModel.milestone },
  })
  .patch('/milestones/:id', ({ params, body }) => Kanban.updateMilestone(params.id, body), {
    detail: {
      'summary': 'Update milestone',
      'x-cradle-cli': {
        command: ['milestone', 'update'],
      },
    },
    params: KanbanModel.idParams,
    body: KanbanModel.updateMilestoneBody,
    response: { 200: KanbanModel.milestone },
  })
  .delete('/milestones/:id', ({ params }) => {
    Kanban.deleteMilestone(params.id)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Delete milestone',
      'x-cradle-cli': {
        command: ['milestone', 'delete'],
      },
    },
    params: KanbanModel.idParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })

  // ── issues ──
  .get('/issues/search', ({ query }) => Kanban.searchIssues(query.q, Number(query.limit) || 20), {
    detail: {
      'summary': 'Search issues',
      'x-cradle-cli': {
        command: ['issue', 'search'],
      },
    },
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
    detail: {
      'summary': 'List issues',
      'x-cradle-cli': {
        command: ['issue', 'list'],
      },
    },
    query: KanbanModel.listIssuesQuery,
    response: { 200: t.Array(KanbanModel.issue) },
  })
  .get('/issues/:id', ({ params }) => Kanban.getIssue(params.id), {
    detail: {
      'summary': 'Get issue',
      'x-cradle-cli': {
        command: ['issue', 'get'],
      },
    },
    params: KanbanModel.idParams,
    response: { 200: KanbanModel.issue },
  })
  .post('/issues', ({ body }) => Kanban.createIssue(body), {
    detail: {
      'summary': 'Create issue',
      'x-cradle-cli': {
        command: ['issue', 'create'],
      },
    },
    body: KanbanModel.createIssueBody,
    response: { 200: KanbanModel.issue },
  })
  .patch('/issues/bulk', ({ body }) => {
    const updated = Kanban.bulkUpdateIssues(body.issueIds, body.update)
    return { updated }
  }, {
    detail: { summary: 'Bulk update issues' },
    body: KanbanModel.bulkUpdateBody,
    response: { 200: t.Object({ updated: t.Number() }) },
  })
  .patch('/issues/:id', ({ params, body }) => Kanban.updateIssue(params.id, body), {
    detail: {
      'summary': 'Update issue',
      'x-cradle-cli': {
        command: ['issue', 'update'],
      },
    },
    params: KanbanModel.idParams,
    body: KanbanModel.updateIssueBody,
    response: { 200: KanbanModel.issue },
  })
  .delete('/issues/:id', ({ params }) => {
    Kanban.deleteIssue(params.id)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Delete issue',
      'x-cradle-cli': {
        command: ['issue', 'delete'],
      },
    },
    params: KanbanModel.idParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })

  // ── comments ──
  .get('/issues/:id/comments', ({ params }) => Kanban.listComments(params.id), {
    detail: {
      'summary': 'List comments',
      'x-cradle-cli': {
        command: ['issue', 'comment', 'list'],
      },
    },
    params: KanbanModel.idParams,
    response: { 200: t.Array(KanbanModel.issueComment) },
  })
  .post('/issues/:id/comments', ({ params, body }) => Kanban.addComment({ issueId: params.id, content: body.content }), {
    detail: {
      'summary': 'Add comment',
      'x-cradle-cli': {
        command: ['issue', 'comment', 'add'],
      },
    },
    params: KanbanModel.idParams,
    body: KanbanModel.addCommentBody,
    response: { 200: KanbanModel.issueComment },
  })
  .delete('/comments/:id', ({ params }) => {
    Kanban.deleteComment(params.id)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Delete comment',
      'x-cradle-cli': {
        command: ['issue', 'comment', 'delete'],
      },
    },
    params: KanbanModel.idParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })

  // ── relations ──
  .get('/issues/:id/relations', ({ params }) => Kanban.listRelations(params.id), {
    detail: {
      'summary': 'List issue relations',
      'x-cradle-cli': {
        command: ['issue', 'relation', 'list'],
      },
    },
    params: KanbanModel.idParams,
    response: { 200: t.Array(KanbanModel.issueRelation) },
  })
  .post('/relations', ({ body }) => Kanban.createRelation(body), {
    detail: {
      'summary': 'Create relation',
      'x-cradle-cli': {
        command: ['issue', 'relation', 'create'],
      },
    },
    body: KanbanModel.createRelationBody,
    response: { 200: KanbanModel.issueRelation },
  })
  .delete('/relations/:id', ({ params }) => {
    Kanban.deleteRelation(params.id)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Delete relation',
      'x-cradle-cli': {
        command: ['issue', 'relation', 'delete'],
      },
    },
    params: KanbanModel.idParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })

  // ── context refs ──
  .post('/issues/:id/context-refs', ({ params, body }) => Kanban.addContextRef(params.id, body.ref), {
    detail: {
      'summary': 'Add context ref',
      'x-cradle-cli': {
        command: ['issue', 'context-ref', 'add'],
      },
    },
    params: KanbanModel.idParams,
    body: KanbanModel.addContextRefBody,
    response: { 200: KanbanModel.issue },
  })
  .delete('/issues/:id/context-refs/:index', ({ params }) => Kanban.removeContextRef(params.id, Number(params.index)), {
    detail: {
      'summary': 'Remove context ref',
      'x-cradle-cli': {
        command: ['issue', 'context-ref', 'remove'],
      },
    },
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
