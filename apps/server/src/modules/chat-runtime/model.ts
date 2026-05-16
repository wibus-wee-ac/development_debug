import { t } from 'elysia'

const uiMessageSchema = t.Object({
  id: t.String(),
  role: t.Union([t.Literal('user'), t.Literal('assistant')]),
  parts: t.Array(t.Object({
    type: t.String(),
  }, { additionalProperties: t.Any() })),
}, { additionalProperties: true })

const chatMessageSnapshotSchema = t.Object({
  messageId: t.String(),
  role: t.Union([t.Literal('user'), t.Literal('assistant')]),
  status: t.Union([t.Literal('streaming'), t.Literal('complete'), t.Literal('aborted'), t.Literal('failed')]),
  errorText: t.Optional(t.String()),
  content: t.String(),
  message: uiMessageSchema,
  parentMessageId: t.Union([t.String(), t.Null()]),
  parentToolCallId: t.Union([t.String(), t.Null()]),
  taskId: t.Union([t.String(), t.Null()]),
  depth: t.Number(),
})

export const ChatRuntimeModel = {
  sessionIdParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
  }),

  responseBody: t.Object({
    text: t.String({ minLength: 1 }),
    modelId: t.Optional(t.String()),
    thinkingEffort: t.Optional(t.Union([t.Literal('low'), t.Literal('medium'), t.Literal('high')])),
  }),

  cancelResponse: t.Object({
    ok: t.Literal(true),
  }),

  chatMessages: t.Array(chatMessageSnapshotSchema),
}
