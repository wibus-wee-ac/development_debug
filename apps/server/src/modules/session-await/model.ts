import { t } from 'elysia'

const awaitStatusEnum = t.Union([
  t.Literal('pending'),
  t.Literal('triggered'),
  t.Literal('expired'),
  t.Literal('cancelled'),
  t.Literal('failed'),
])

export const SessionAwaitModel = {
  sessionAwait: t.Object({
    id: t.String(),
    chatSessionId: t.String(),
    workspaceId: t.String(),
    source: t.String(),
    filterJson: t.String(),
    status: awaitStatusEnum,
    reason: t.Nullable(t.String()),
    resumePayloadJson: t.Nullable(t.String()),
    createdAt: t.Number(),
    triggeredAt: t.Nullable(t.Number()),
    expiresAt: t.Nullable(t.Number()),
    fireAt: t.Nullable(t.Number()),
    lastCheckedAt: t.Nullable(t.Number()),
    lastErrorText: t.Nullable(t.String()),
  }),

  summary: t.Object({
    awaiting: t.Boolean(),
    pendingCount: t.Number(),
    primarySource: t.Nullable(t.String()),
    reason: t.Nullable(t.String()),
  }),

  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }),

  listQuery: t.Object({
    sessionId: t.String({ minLength: 1 }),
  }),

  createBody: t.Object({
    chatSessionId: t.String({ minLength: 1 }),
    workspaceId: t.String({ minLength: 1 }),
    source: t.String({ minLength: 1 }),
    filterJson: t.String({ minLength: 1 }),
    reason: t.Optional(t.Nullable(t.String())),
    expiresAt: t.Optional(t.Nullable(t.Number())),
    fireAt: t.Optional(t.Nullable(t.Number())),
  }),

  triggerBody: t.Object({
    resumeText: t.String({ minLength: 1 }),
    resumePayloadJson: t.Optional(t.Nullable(t.String())),
  }),

  summaryQuery: t.Object({
    sessionId: t.String({ minLength: 1 }),
  }),
}
