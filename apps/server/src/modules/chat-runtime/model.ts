import { t } from 'elysia'

const storedChunkSchema = t.Object({
  id: t.String(),
  runId: t.String(),
  chatSessionId: t.String(),
  sequenceNumber: t.Number(),
  schemaVersion: t.String(),
  createdAt: t.Number(),
  parentToolCallId: t.Union([t.String(), t.Null()]),
  taskId: t.Union([t.String(), t.Null()]),
  chunk: t.Object({
    type: t.String(),
  }, { additionalProperties: true }),
})

const chatChunkGroupSchema = t.Object({
  messageId: t.String(),
  role: t.Union([t.Literal('user'), t.Literal('assistant')]),
  userText: t.Optional(t.String()),
  status: t.Union([t.Literal('streaming'), t.Literal('complete'), t.Literal('aborted'), t.Literal('failed')]),
  errorText: t.Optional(t.String()),
  chunks: t.Array(storedChunkSchema),
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

  chatMessages: t.Array(chatChunkGroupSchema),
}
