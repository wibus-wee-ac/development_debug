import { t } from 'elysia'

const runtimeKindSchema = t.Union([
  t.Literal('standard'),
  t.Literal('claude-agent'),
  t.Literal('codex'),
  t.Literal('jar-core'),
  t.Literal('acp-chat'),
  t.Literal('cli-tui'),
])

const nullableString = t.Nullable(t.String())
const nullableRequiredString = t.Nullable(t.String({ minLength: 1 }))
const sessionStatusSchema = t.Union([
  t.Literal('idle'),
  t.Literal('streaming'),
])

export const SessionModel = {
  session: t.Object({
    id: t.String(),
    workspaceId: nullableString,
    title: nullableString,
    providerTargetId: nullableString,
    agentId: nullableString,
    modelId: nullableString,
    linkedIssueId: nullableString,
    runtimeKind: runtimeKindSchema,
    status: sessionStatusSchema,
    pinned: t.Number(),
    archivedAt: t.Nullable(t.Number()),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  message: t.Object({
    id: t.String(),
    sessionId: t.String(),
    parentMessageId: nullableString,
    parentToolCallId: nullableString,
    taskId: nullableString,
    depth: t.Number(),
    role: t.Union([t.Literal('user'), t.Literal('assistant')]),
    status: t.Union([t.Literal('streaming'), t.Literal('complete'), t.Literal('aborted'), t.Literal('failed')]),
    content: t.String(),
    messageJson: t.String(),
    errorText: nullableString,
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
    workspaceId: t.Optional(t.String({ minLength: 1 })),
    archived: t.Optional(t.Boolean()),
  }),

  createBody: t.Object({
    workspaceId: t.Optional(nullableRequiredString),
    title: t.String({ minLength: 1 }),
    providerTargetId: t.Optional(nullableRequiredString),
    agentId: t.Optional(t.String({ minLength: 1 })),
    runtimeKind: t.Optional(runtimeKindSchema),
    id: t.Optional(t.String()),
  }),

  updateBody: t.Object({
    title: t.Optional(t.String({ minLength: 1 })),
    pinned: t.Optional(t.Boolean()),
  }),

  archiveBody: t.Object({
    archived: t.Boolean(),
  }),
}
