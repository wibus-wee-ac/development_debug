import { t } from 'elysia'

const timelineSourceSchema = t.Object({
  backend: t.String(),
  eventType: t.String(),
  eventId: t.Optional(t.Nullable(t.String())),
  itemId: t.Optional(t.Nullable(t.String())),
  metadata: t.Optional(t.Record(t.String(), t.Unknown())),
})

const storedTimelineEventSchema = t.Object({
  id: t.String(),
  runId: t.String(),
  chatSessionId: t.String(),
  sequenceNumber: t.Number(),
  schemaVersion: t.String(),
  createdAt: t.Number(),
  type: t.String(),
  source: timelineSourceSchema,
})

const chatTimelineGroupSchema = t.Object({
  messageId: t.String(),
  role: t.Union([t.Literal('user'), t.Literal('assistant')]),
  userText: t.Optional(t.String()),
  status: t.Union([t.Literal('streaming'), t.Literal('complete'), t.Literal('aborted'), t.Literal('failed')]),
  errorText: t.Optional(t.String()),
  events: t.Array(storedTimelineEventSchema),
})

export const ChatRuntimeModel = {
  sessionIdParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
  }),

  runIdParams: t.Object({
    runId: t.String({ minLength: 1 }),
  }),

  createRunBody: t.Object({
    text: t.String({ minLength: 1 }),
    modelId: t.Optional(t.String()),
    thinkingEffort: t.Optional(t.Union([t.Literal('low'), t.Literal('medium'), t.Literal('high')])),
  }),

  createRunResponse: t.Object({
    runId: t.String(),
    assistantMessageId: t.String(),
    userMessageId: t.String(),
  }),

  updateRunBody: t.Object({
    status: t.Literal('aborted'),
  }),

  updateRunResponse: t.Object({
    ok: t.Literal(true),
  }),

  chatTimeline: t.Array(chatTimelineGroupSchema),
}
