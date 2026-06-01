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

const runtimeUiSlotSchema = t.Object({
  id: t.String(),
  name: t.String(),
  label: t.String(),
  description: t.String(),
  argumentHint: t.String(),
  aliases: t.Optional(t.Array(t.String())),
  iconKey: t.Optional(t.Union([
    t.Literal('alert'),
    t.Literal('approvals'),
    t.Literal('code-review'),
    t.Literal('compact'),
    t.Literal('config'),
    t.Literal('diff'),
    t.Literal('feedback'),
    t.Literal('filesystem'),
    t.Literal('goal'),
    t.Literal('crew'),
    t.Literal('ide-context'),
    t.Literal('mcp'),
    t.Literal('model'),
    t.Literal('personality'),
    t.Literal('plugin'),
    t.Literal('plan'),
    t.Literal('reasoning'),
    t.Literal('search'),
    t.Literal('side-chat'),
    t.Literal('skills'),
    t.Literal('status'),
    t.Literal('terminal'),
    t.Literal('tool-activity'),
    t.Literal('usage'),
  ])),
  commandText: t.Optional(t.String()),
})

const runtimeGoalStatusSchema = t.Union([
  t.Literal('active'),
  t.Literal('paused'),
  t.Literal('blocked'),
  t.Literal('usageLimited'),
  t.Literal('budgetLimited'),
  t.Literal('complete'),
])

const runtimeGoalUiSlotStateSchema = t.Object({
  kind: t.Literal('goal'),
  slotId: t.String(),
  threadId: t.String(),
  objective: t.String(),
  status: runtimeGoalStatusSchema,
  tokenBudget: t.Union([t.Number(), t.Null()]),
  tokensUsed: t.Number(),
  timeUsedSeconds: t.Number(),
  createdAt: t.Number(),
  updatedAt: t.Number(),
})

const runtimeTokenUsageBreakdownSchema = t.Object({
  totalTokens: t.Number(),
  inputTokens: t.Number(),
  cachedInputTokens: t.Number(),
  outputTokens: t.Number(),
  reasoningOutputTokens: t.Number(),
})

const runtimeCompactStatusSchema = t.Union([
  t.Literal('idle'),
  t.Literal('running'),
  t.Literal('nearLimit'),
  t.Literal('overLimit'),
  t.Literal('compacted'),
])

const runtimeCompactUiSlotStateSchema = t.Object({
  kind: t.Literal('compact'),
  slotId: t.String(),
  threadId: t.String(),
  turnId: t.Union([t.String(), t.Null()]),
  status: runtimeCompactStatusSchema,
  isCompactRelevant: t.Boolean(),
  total: runtimeTokenUsageBreakdownSchema,
  last: runtimeTokenUsageBreakdownSchema,
  modelContextWindow: t.Union([t.Number(), t.Null()]),
  autoCompactTokenLimit: t.Union([t.Number(), t.Null()]),
  usagePercent: t.Union([t.Number(), t.Null()]),
  autoCompactPercent: t.Union([t.Number(), t.Null()]),
  lastCompactedAt: t.Union([t.Number(), t.Null()]),
  compactionItemId: t.Union([t.String(), t.Null()]),
  updatedAt: t.Number(),
})

const runtimeStatusUiSlotStateSchema = t.Object({
  kind: t.Literal('status'),
  slotId: t.String(),
  threadId: t.String(),
  status: t.Union([
    t.Literal('notLoaded'),
    t.Literal('idle'),
    t.Literal('systemError'),
    t.Literal('active'),
  ]),
  activeFlags: t.Array(t.String()),
  updatedAt: t.Number(),
})

const runtimeModelUiSlotStateSchema = t.Object({
  kind: t.Literal('model'),
  slotId: t.String(),
  threadId: t.String(),
  modelId: t.Union([t.String(), t.Null()]),
  modelLabel: t.Union([t.String(), t.Null()]),
  modelProvider: t.Union([t.String(), t.Null()]),
  serviceTier: t.Union([t.String(), t.Null()]),
  supportsImages: t.Union([t.Boolean(), t.Null()]),
  supportsWebSearch: t.Union([t.Boolean(), t.Null()]),
  supportsNamespaceTools: t.Union([t.Boolean(), t.Null()]),
  updatedAt: t.Number(),
})

const runtimeReasoningUiSlotStateSchema = t.Object({
  kind: t.Literal('reasoning'),
  slotId: t.String(),
  threadId: t.String(),
  effort: t.Union([t.String(), t.Null()]),
  summary: t.Union([t.String(), t.Null()]),
  supportedEfforts: t.Array(t.Object({
    id: t.String(),
    description: t.String(),
  })),
  updatedAt: t.Number(),
})

const runtimePlanStepStatusSchema = t.Union([
  t.Literal('pending'),
  t.Literal('inProgress'),
  t.Literal('completed'),
])

const runtimePlanUiSlotStateSchema = t.Object({
  kind: t.Literal('plan'),
  slotId: t.String(),
  threadId: t.String(),
  turnId: t.Union([t.String(), t.Null()]),
  explanation: t.Union([t.String(), t.Null()]),
  steps: t.Array(t.Object({
    step: t.String(),
    status: runtimePlanStepStatusSchema,
  })),
  currentStep: t.Union([t.String(), t.Null()]),
  pendingCount: t.Number(),
  inProgressCount: t.Number(),
  completedCount: t.Number(),
  updatedAt: t.Number(),
})

const runtimeToolActivityStatusSchema = t.Union([
  t.Literal('running'),
  t.Literal('completed'),
  t.Literal('failed'),
])

const runtimeToolActivityUiSlotStateSchema = t.Object({
  kind: t.Literal('toolActivity'),
  slotId: t.String(),
  threadId: t.String(),
  turnId: t.Union([t.String(), t.Null()]),
  activeCount: t.Number(),
  completedCount: t.Number(),
  failedCount: t.Number(),
  recentItems: t.Array(t.Object({
    id: t.String(),
    type: t.String(),
    label: t.String(),
    status: runtimeToolActivityStatusSchema,
    startedAt: t.Union([t.Number(), t.Null()]),
    completedAt: t.Union([t.Number(), t.Null()]),
  })),
  updatedAt: t.Number(),
})

const runtimeMcpServerStatusSchema = t.Union([
  t.Literal('starting'),
  t.Literal('ready'),
  t.Literal('failed'),
  t.Literal('cancelled'),
  t.Literal('unknown'),
])

const runtimeMcpAuthStatusSchema = t.Union([
  t.Literal('unsupported'),
  t.Literal('notLoggedIn'),
  t.Literal('bearerToken'),
  t.Literal('oAuth'),
  t.Literal('unknown'),
])

const runtimeMcpUiSlotStateSchema = t.Object({
  kind: t.Literal('mcp'),
  slotId: t.String(),
  threadId: t.String(),
  serverCount: t.Number(),
  readyCount: t.Number(),
  failedCount: t.Number(),
  needsLoginCount: t.Number(),
  recentProgress: t.Union([t.String(), t.Null()]),
  servers: t.Array(t.Object({
    name: t.String(),
    status: runtimeMcpServerStatusSchema,
    authStatus: runtimeMcpAuthStatusSchema,
    toolCount: t.Number(),
    resourceCount: t.Number(),
    error: t.Union([t.String(), t.Null()]),
  })),
  updatedAt: t.Number(),
})

const runtimeDiffUiSlotStateSchema = t.Object({
  kind: t.Literal('diff'),
  slotId: t.String(),
  threadId: t.String(),
  turnId: t.Union([t.String(), t.Null()]),
  fileCount: t.Number(),
  addedLines: t.Number(),
  removedLines: t.Number(),
  hasDiff: t.Boolean(),
  updatedAt: t.Number(),
})

const runtimeTerminalUiSlotStateSchema = t.Object({
  kind: t.Literal('terminal'),
  slotId: t.String(),
  threadId: t.String(),
  turnId: t.Union([t.String(), t.Null()]),
  activeCount: t.Number(),
  completedCount: t.Number(),
  failedCount: t.Number(),
  lastCommand: t.Union([t.String(), t.Null()]),
  lastOutputPreview: t.Union([t.String(), t.Null()]),
  updatedAt: t.Number(),
})

const runtimeApprovalStatusSchema = t.Union([
  t.Literal('pending'),
  t.Literal('approved'),
  t.Literal('denied'),
  t.Literal('timedOut'),
  t.Literal('aborted'),
])

const runtimeApprovalsUiSlotStateSchema = t.Object({
  kind: t.Literal('approvals'),
  slotId: t.String(),
  threadId: t.String(),
  turnId: t.Union([t.String(), t.Null()]),
  pendingCount: t.Number(),
  approvedCount: t.Number(),
  deniedCount: t.Number(),
  recentItems: t.Array(t.Object({
    id: t.String(),
    targetItemId: t.Union([t.String(), t.Null()]),
    status: runtimeApprovalStatusSchema,
    label: t.String(),
    riskLevel: t.Union([t.String(), t.Null()]),
    rationale: t.Union([t.String(), t.Null()]),
    startedAt: t.Union([t.Number(), t.Null()]),
    completedAt: t.Union([t.Number(), t.Null()]),
  })),
  updatedAt: t.Number(),
})

const runtimeAlertSeveritySchema = t.Union([
  t.Literal('info'),
  t.Literal('warning'),
  t.Literal('error'),
])

const runtimeAlertUiSlotStateSchema = t.Object({
  kind: t.Literal('alert'),
  slotId: t.String(),
  threadId: t.Union([t.String(), t.Null()]),
  warningCount: t.Number(),
  errorCount: t.Number(),
  recentItems: t.Array(t.Object({
    id: t.String(),
    severity: runtimeAlertSeveritySchema,
    message: t.String(),
    source: t.String(),
    updatedAt: t.Number(),
  })),
  updatedAt: t.Number(),
})

const runtimeFilesystemUiSlotStateSchema = t.Object({
  kind: t.Literal('filesystem'),
  slotId: t.String(),
  threadId: t.String(),
  changedPathCount: t.Number(),
  recentPaths: t.Array(t.String()),
  updatedAt: t.Number(),
})

const runtimeSkillsUiSlotStateSchema = t.Object({
  kind: t.Literal('skills'),
  slotId: t.String(),
  threadId: t.String(),
  enabledCount: t.Number(),
  disabledCount: t.Number(),
  errorCount: t.Number(),
  roots: t.Array(t.String()),
  updatedAt: t.Number(),
})

const runtimePluginUiSlotStateSchema = t.Object({
  kind: t.Literal('plugin'),
  slotId: t.String(),
  threadId: t.String(),
  installedCount: t.Number(),
  enabledCount: t.Number(),
  appCount: t.Number(),
  marketplaceCount: t.Number(),
  errorCount: t.Number(),
  updatedAt: t.Number(),
})

const runtimeSearchUiSlotStateSchema = t.Object({
  kind: t.Literal('search'),
  slotId: t.String(),
  threadId: t.String(),
  recentResultCount: t.Number(),
  recentQuery: t.Union([t.String(), t.Null()]),
  fuzzySessionActive: t.Boolean(),
  updatedAt: t.Number(),
})

const runtimeCrewUiSlotStateSchema = t.Object({
  kind: t.Literal('crew'),
  slotId: t.String(),
  threadId: t.String(),
  activeCount: t.Number(),
  completedCount: t.Number(),
  failedCount: t.Number(),
  recentItems: t.Array(t.Object({
    id: t.String(),
    type: t.String(),
    label: t.String(),
    status: runtimeToolActivityStatusSchema,
    startedAt: t.Union([t.Number(), t.Null()]),
    completedAt: t.Union([t.Number(), t.Null()]),
  })),
  collaborationModeCount: t.Number(),
  updatedAt: t.Number(),
})

const runtimeUsageUiSlotStateSchema = t.Object({
  kind: t.Literal('usage'),
  slotId: t.String(),
  threadId: t.String(),
  usedPercent: t.Union([t.Number(), t.Null()]),
  secondaryUsedPercent: t.Union([t.Number(), t.Null()]),
  creditsBalance: t.Union([t.String(), t.Null()]),
  hasCredits: t.Union([t.Boolean(), t.Null()]),
  rateLimitReachedType: t.Union([t.String(), t.Null()]),
  planType: t.Union([t.String(), t.Null()]),
  updatedAt: t.Number(),
})

const runtimeConfigUiSlotStateSchema = t.Object({
  kind: t.Literal('config'),
  slotId: t.String(),
  threadId: t.String(),
  modelId: t.Union([t.String(), t.Null()]),
  approvalPolicy: t.Union([t.String(), t.Null()]),
  sandboxMode: t.Union([t.String(), t.Null()]),
  allowedApprovalPolicyCount: t.Union([t.Number(), t.Null()]),
  allowedSandboxModeCount: t.Union([t.Number(), t.Null()]),
  featureRequirementCount: t.Union([t.Number(), t.Null()]),
  webSearchModeCount: t.Union([t.Number(), t.Null()]),
  updatedAt: t.Number(),
})

const runtimeUiSlotStateSchema = t.Union([
  runtimeGoalUiSlotStateSchema,
  runtimeCompactUiSlotStateSchema,
  runtimeStatusUiSlotStateSchema,
  runtimeModelUiSlotStateSchema,
  runtimeReasoningUiSlotStateSchema,
  runtimePlanUiSlotStateSchema,
  runtimeToolActivityUiSlotStateSchema,
  runtimeMcpUiSlotStateSchema,
  runtimeDiffUiSlotStateSchema,
  runtimeTerminalUiSlotStateSchema,
  runtimeApprovalsUiSlotStateSchema,
  runtimeAlertUiSlotStateSchema,
  runtimeFilesystemUiSlotStateSchema,
  runtimeSkillsUiSlotStateSchema,
  runtimePluginUiSlotStateSchema,
  runtimeSearchUiSlotStateSchema,
  runtimeCrewUiSlotStateSchema,
  runtimeUsageUiSlotStateSchema,
  runtimeConfigUiSlotStateSchema,
])

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

const codexAppServerCapabilitySchema = t.Object({
  method: t.String(),
  paramsType: t.Nullable(t.String()),
  category: t.String(),
  operation: t.String(),
  interaction: t.Union([t.Literal('request'), t.Literal('stream')]),
})

const codexAppServerServerMessageSchema = t.Object({
  method: t.String(),
  paramsType: t.String(),
  category: t.String(),
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

  codexAppServerCapabilities: t.Object({
    protocol: t.String(),
    generatorVersion: t.String(),
    generatedDate: t.String(),
    clientMethods: t.Array(codexAppServerCapabilitySchema),
    serverRequests: t.Array(codexAppServerServerMessageSchema),
    serverNotifications: t.Array(codexAppServerServerMessageSchema),
  }),

  codexAppServerInvokeBody: t.Object({
    method: t.String({ minLength: 1 }),
    params: t.Optional(t.Any()),
    providerTargetId: t.Optional(t.String()),
    modelId: t.Optional(t.String()),
  }),

  codexAppServerStreamBody: t.Object({
    method: t.String({ minLength: 1 }),
    params: t.Optional(t.Any()),
    providerTargetId: t.Optional(t.String()),
    modelId: t.Optional(t.String()),
    closeOnMethods: t.Optional(t.Array(t.String({ minLength: 1 }))),
  }),

  codexAppServerInvokeResponse: t.Object({
    method: t.String(),
    capability: codexAppServerCapabilitySchema,
    result: t.Any(),
  }),

  capabilities: t.Object({
    runtimeKind: t.String(),
    slashCommands: t.Array(slashCommandSchema),
    uiSlots: t.Array(runtimeUiSlotSchema),
    skills: t.Array(t.String()),
  }),

  uiSlotStates: t.Object({
    runtimeKind: t.String(),
    states: t.Array(runtimeUiSlotStateSchema),
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
