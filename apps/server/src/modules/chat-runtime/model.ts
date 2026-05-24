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

const slashCommandSchema = t.Object({
  name: t.String(),
  description: t.String(),
  argumentHint: t.String(),
  aliases: t.Optional(t.Array(t.String())),
})

const filePartSchema = t.Object({
  type: t.Literal('file'),
  mediaType: t.String({ minLength: 1 }),
  filename: t.Optional(t.String()),
  url: t.String({ minLength: 1 }),
  providerMetadata: t.Optional(t.Any()),
}, { additionalProperties: true })

const queueModeSchema = t.Union([t.Literal('queue'), t.Literal('steer')])
const queueStatusSchema = t.Union([
  t.Literal('pending'),
  t.Literal('running'),
  t.Literal('cancelled'),
  t.Literal('completed'),
  t.Literal('failed'),
])

const queueItemSchema = t.Object({
  id: t.String(),
  sessionId: t.String(),
  mode: queueModeSchema,
  status: queueStatusSchema,
  text: t.String(),
  files: t.Array(filePartSchema),
  agentProfileId: t.Union([t.String(), t.Null()]),
  modelId: t.Union([t.String(), t.Null()]),
  thinkingEffort: t.Union([t.Literal('low'), t.Literal('medium'), t.Literal('high'), t.Null()]),
  position: t.Number(),
  sourceRunId: t.Union([t.String(), t.Null()]),
  startedRunId: t.Union([t.String(), t.Null()]),
  errorText: t.Union([t.String(), t.Null()]),
  createdAt: t.Number(),
  updatedAt: t.Number(),
})

export const ChatRuntimeModel = {
  sessionIdParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
  }),

  queueItemParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
    queueItemId: t.String({ minLength: 1 }),
  }),

  responseBody: t.Object({
    text: t.Optional(t.String()),
    files: t.Optional(t.Array(filePartSchema)),
    agentProfileId: t.Optional(t.String()),
    modelId: t.Optional(t.String()),
    thinkingEffort: t.Optional(t.Union([t.Literal('low'), t.Literal('medium'), t.Literal('high')])),
  }),

  cancelResponse: t.Object({
    ok: t.Literal(true),
  }),

  capabilities: t.Object({
    runtimeKind: t.String(),
    slashCommands: t.Array(slashCommandSchema),
    skills: t.Array(t.String()),
  }),

  chatMessages: t.Array(chatMessageSnapshotSchema),

  queueItem: queueItemSchema,

  queueListResponse: t.Object({
    items: t.Array(queueItemSchema),
  }),

  queueEnqueueBody: t.Object({
    mode: queueModeSchema,
    text: t.Optional(t.String({ minLength: 1 })),
    files: t.Optional(t.Array(filePartSchema)),
    agentProfileId: t.Optional(t.String()),
    modelId: t.Optional(t.String()),
    thinkingEffort: t.Optional(t.Union([t.Literal('low'), t.Literal('medium'), t.Literal('high')])),
  }),

  queueReorderBody: t.Object({
    queueItemIds: t.Array(t.String({ minLength: 1 })),
  }),
}
