import { t } from 'elysia'

const runtimeKindSchema = t.Union([
  t.Literal('standard'),
  t.Literal('claude-agent'),
  t.Literal('codex'),
  t.Literal('jar-core'),
  t.Literal('acp-chat'),
  t.Literal('cli-tui'),
])

export const SessionModel = {
  session: t.Object({
    id: t.String(),
    workspaceId: t.Nullable(t.String()),
    title: t.Nullable(t.String()),
    agentProfileId: t.Nullable(t.String()),
    agentId: t.Nullable(t.String()),
    modelId: t.Nullable(t.String()),
    linkedIssueId: t.Nullable(t.String()),
    runtimeKind: runtimeKindSchema,
    pinned: t.Number(),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  message: t.Object({
    id: t.String(),
    sessionId: t.String(),
    parentMessageId: t.Nullable(t.String()),
    parentToolCallId: t.Nullable(t.String()),
    taskId: t.Nullable(t.String()),
    depth: t.Number(),
    role: t.Union([t.Literal('user'), t.Literal('assistant')]),
    status: t.Union([t.Literal('streaming'), t.Literal('complete'), t.Literal('aborted'), t.Literal('failed')]),
    content: t.String(),
    messageJson: t.String(),
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
    workspaceId: t.Optional(t.String({ minLength: 1 })),
    title: t.String({ minLength: 1 }),
    agentProfileId: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
    agentId: t.Optional(t.String({ minLength: 1 })),
    runtimeKind: t.Optional(runtimeKindSchema),
    id: t.Optional(t.String()),
  }),

  updateBody: t.Object({
    title: t.Optional(t.String({ minLength: 1 })),
    pinned: t.Optional(t.Boolean()),
  }),
}
