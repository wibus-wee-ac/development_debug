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
const permissionModeSchema = t.Union([
  t.Literal('bypassPermissions'),
  t.Literal('plan'),
])
const queueStatusSchema = t.Union([
  t.Literal('pending'),
  t.Literal('running'),
  t.Literal('cancelled'),
  t.Literal('completed'),
  t.Literal('failed'),
])
const messageStatusSchema = t.Union([
  t.Literal('streaming'),
  t.Literal('complete'),
  t.Literal('aborted'),
  t.Literal('failed'),
])
const tracePhaseSchema = t.Union([
  t.Literal('run_started'),
  t.Literal('provider_raw'),
  t.Literal('mapper_output'),
  t.Literal('runtime_chunk'),
  t.Literal('sse_emit'),
  t.Literal('run_completed'),
  t.Literal('run_failed'),
  t.Literal('run_aborted'),
])

const queueItemSchema = t.Object({
  id: t.String(),
  sessionId: t.String(),
  mode: queueModeSchema,
  status: queueStatusSchema,
  text: t.String(),
  files: t.Array(filePartSchema),
  providerTargetId: t.Union([t.String(), t.Null()]),
  modelId: t.Union([t.String(), t.Null()]),
  thinkingEffort: t.Union([t.Literal('low'), t.Literal('medium'), t.Literal('high'), t.Null()]),
  permissionMode: t.Union([
    t.Literal('bypassPermissions'),
    t.Literal('plan'),
    t.Null(),
  ]),
  position: t.Number(),
  sourceRunId: t.Union([t.String(), t.Null()]),
  startedRunId: t.Union([t.String(), t.Null()]),
  errorText: t.Union([t.String(), t.Null()]),
  createdAt: t.Number(),
  updatedAt: t.Number(),
})

const traceRecordSchema = t.Object({
  schema: t.Literal('cradle.chat-stream-trace.v1'),
  seq: t.Number(),
  phase: tracePhaseSchema,
  timestamp: t.Number(),
  chatSessionId: t.String(),
  runId: t.String(),
  messageId: t.String(),
  runtimeKind: t.String(),
  providerSessionId: t.Union([t.String(), t.Null()]),
  toolCallId: t.Union([t.String(), t.Null()]),
  payload: t.Any(),
})

const runTraceSchema = t.Object({
  runId: t.String(),
  sessionId: t.String(),
  messageId: t.Union([t.String(), t.Null()]),
  status: messageStatusSchema,
  startedAt: t.Number(),
  finishedAt: t.Union([t.Number(), t.Null()]),
  path: t.String(),
  recordCount: t.Number(),
  records: t.Array(traceRecordSchema),
})

const runtimeStatusSchema = t.Union([
  t.Literal('idle'),
  t.Literal('pending'),
  t.Literal('streaming'),
  t.Literal('cancelling'),
])

const runtimeSessionRunSchema = t.Object({
  runId: t.String(),
  messageId: t.Union([t.String(), t.Null()]),
  status: messageStatusSchema,
  startedAt: t.Number(),
  finishedAt: t.Union([t.Number(), t.Null()]),
  modelId: t.Union([t.String(), t.Null()]),
  providerSessionId: t.Union([t.String(), t.Null()]),
  queueItemId: t.Union([t.String(), t.Null()]),
  permissionMode: t.Union([
    t.Literal('bypassPermissions'),
    t.Literal('plan'),
    t.Null(),
  ]),
})

export const ChatRuntimeModel = {
  sessionIdParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
  }),

  runIdParams: t.Object({
    runId: t.String({ minLength: 1 }),
  }),

  queueItemParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
    queueItemId: t.String({ minLength: 1 }),
  }),

  responseBody: t.Object({
    text: t.Optional(t.String()),
    files: t.Optional(t.Array(filePartSchema)),
    messages: t.Optional(t.Array(uiMessageSchema)),
    providerTargetId: t.Optional(t.String()),
    modelId: t.Optional(t.String()),
    thinkingEffort: t.Optional(t.Union([t.Literal('low'), t.Literal('medium'), t.Literal('high')])),
    permissionMode: t.Optional(permissionModeSchema),
  }),

  cancelResponse: t.Object({
    ok: t.Literal(true),
  }),

  permissionModeBody: t.Object({
    mode: permissionModeSchema,
  }),

  permissionModeResponse: t.Object({
    ok: t.Boolean(),
  }),

  capabilities: t.Object({
    runtimeKind: t.String(),
    slashCommands: t.Array(slashCommandSchema),
    skills: t.Array(t.String()),
  }),

  runtimeStatus: t.Object({
    sessionId: t.String(),
    status: runtimeStatusSchema,
    runtimeKind: t.String(),
    providerTargetId: t.Union([t.String(), t.Null()]),
    providerSessionId: t.Union([t.String(), t.Null()]),
    modelId: t.Union([t.String(), t.Null()]),
    permissionMode: t.Union([
      t.Literal('bypassPermissions'),
      t.Literal('plan'),
      t.Null(),
    ]),
    pendingQueueItemId: t.Union([t.String(), t.Null()]),
    activeRun: t.Union([runtimeSessionRunSchema, t.Null()]),
    latestRun: t.Union([runtimeSessionRunSchema, t.Null()]),
    queue: t.Object({
      pending: t.Number(),
      running: t.Number(),
    }),
  }),

  chatMessages: t.Array(chatMessageSnapshotSchema),

  queueItem: queueItemSchema,

  queueListResponse: t.Object({
    items: t.Array(queueItemSchema),
  }),

  traceRecord: traceRecordSchema,

  runTrace: runTraceSchema,

  sessionTraces: t.Object({
    sessionId: t.String(),
    traces: t.Array(runTraceSchema),
  }),

  queueEnqueueBody: t.Object({
    mode: queueModeSchema,
    text: t.Optional(t.String({ minLength: 1 })),
    files: t.Optional(t.Array(filePartSchema)),
    providerTargetId: t.Optional(t.String()),
    modelId: t.Optional(t.String()),
    thinkingEffort: t.Optional(t.Union([t.Literal('low'), t.Literal('medium'), t.Literal('high')])),
    permissionMode: t.Optional(permissionModeSchema),
  }),

  queueReorderBody: t.Object({
    queueItemIds: t.Array(t.String({ minLength: 1 })),
  }),
}
