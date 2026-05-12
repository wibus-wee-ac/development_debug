import { t } from 'elysia'

export const SessionModel = {
  session: t.Object({
    id: t.String(),
    workspaceId: t.String(),
    title: t.Nullable(t.String()),
    agentProfileId: t.Nullable(t.String()),
    agentId: t.Nullable(t.String()),
    linkedIssueId: t.Nullable(t.String()),
    pinned: t.Number(),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  message: t.Object({
    id: t.String(),
    sessionId: t.String(),
    role: t.Union([t.Literal('user'), t.Literal('assistant')]),
    status: t.Union([t.Literal('streaming'), t.Literal('complete'), t.Literal('aborted'), t.Literal('failed')]),
    content: t.Nullable(t.String()),
    errorText: t.Nullable(t.String()),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  exportMarkdownResponse: t.Object({
    markdown: t.String(),
  }),

  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }),

  listQuery: t.Object({
    workspaceId: t.String({ minLength: 1 }),
  }),

  createBody: t.Object({
    workspaceId: t.String({ minLength: 1 }),
    title: t.String({ minLength: 1 }),
    agentProfileId: t.String({ minLength: 1 }),
    id: t.Optional(t.String()),
  }),

  updateBody: t.Object({
    title: t.Optional(t.String({ minLength: 1 })),
    pinned: t.Optional(t.Boolean()),
  }),
}
