import { z } from 'zod'

export const ChatRuntimeEventTypeSchema = z.enum([
  'user_message.appended',
  'assistant_message.created',
  'assistant_message.part_recorded',
  'assistant_message.snapshot_recorded',
  'tool_call.requested',
  'tool_call.arguments_recorded',
  'tool_call.result_recorded',
  'tool_call.approval_requested',
  'tool_call.user_input_requested',
  'tool_call.user_input_answered',
  'run.start_requested',
  'run.started',
  'run.completed',
  'run.failed',
  'run.aborted',
  'run.interrupted',
  'queue.item_enqueued',
  'queue.item_claimed',
  'queue.item_completed',
  'queue.item_failed',
  'queue.item_cancelled',
  'queue.item_reordered',
  'run.provider_context_recorded',
  'codex.goal_continuation_scheduled',
  'codex.goal_continuation_started',
  'codex.goal_continuation_skipped',
])

export type ChatRuntimeEventType = z.infer<typeof ChatRuntimeEventTypeSchema>

export type ChatRuntimeActorKind = 'user' | 'agent' | 'system' | 'runtime' | 'provider'

export interface ChatRuntimeEventRecord {
  id: string
  streamId: string
  seq: number
  type: ChatRuntimeEventType
  commandId: string | null
  actorKind: ChatRuntimeActorKind | null
  actorId: string | null
  runId: string | null
  messageId: string | null
  queueItemId: string | null
  occurredAt: number
  payload: Record<string, unknown>
}

export interface NewChatRuntimeEvent {
  id?: string
  type: ChatRuntimeEventType
  actorKind?: ChatRuntimeActorKind | null
  actorId?: string | null
  runId?: string | null
  messageId?: string | null
  queueItemId?: string | null
  occurredAt?: number
  payload?: Record<string, unknown>
}

const ChatRuntimeActorKindSchema = z.enum(['user', 'agent', 'system', 'runtime', 'provider'])
const NewChatRuntimeEventSchema = z.object({
  id: z.string().optional(),
  type: ChatRuntimeEventTypeSchema,
  actorKind: ChatRuntimeActorKindSchema.nullable().optional(),
  actorId: z.string().nullable().optional(),
  runId: z.string().nullable().optional(),
  messageId: z.string().nullable().optional(),
  queueItemId: z.string().nullable().optional(),
  occurredAt: z.number().finite().optional(),
  payload: z.object({}).passthrough().optional(),
}).superRefine((event, context) => {
  switch (event.type) {
    case 'user_message.appended':
    case 'assistant_message.created':
    case 'assistant_message.snapshot_recorded':
      requireStringField(event.messageId, 'messageId', context)
      break
    case 'run.start_requested':
    case 'run.started':
    case 'run.completed':
    case 'run.failed':
    case 'run.aborted':
    case 'run.interrupted':
      requireStringField(event.runId, 'runId', context)
      break
    case 'queue.item_enqueued':
    case 'queue.item_claimed':
    case 'queue.item_completed':
    case 'queue.item_failed':
    case 'queue.item_cancelled':
      requireStringField(event.queueItemId, 'queueItemId', context)
      break
    case 'queue.item_reordered':
      validateQueueReorderedPayload(event.payload ?? {}, context)
      break
    case 'run.provider_context_recorded':
      requireStringField(event.runId, 'runId', context)
      validateRunProviderContextPayload(event.payload ?? {}, context)
      break
    default:
      break
  }
})

export type ChatRuntimeRunStatus = 'streaming' | 'complete' | 'aborted' | 'failed'
export type ChatRuntimeQueueStatus = 'pending' | 'running' | 'cancelled' | 'completed' | 'failed'

export function isTerminalRunEventType(type: ChatRuntimeEventType): boolean {
  return (
    type === 'run.completed'
    || type === 'run.failed'
    || type === 'run.aborted'
    || type === 'run.interrupted'
  )
}

export function readRunStatusFromEventType(type: ChatRuntimeEventType): ChatRuntimeRunStatus | null {
  switch (type) {
    case 'run.started':
      return 'streaming'
    case 'run.completed':
      return 'complete'
    case 'run.aborted':
      return 'aborted'
    case 'run.failed':
    case 'run.interrupted':
      return 'failed'
    default:
      return null
  }
}

export function parseChatRuntimeEventPayload(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {}
  }
  return parsed as Record<string, unknown>
}

export function validateNewChatRuntimeEvent(event: NewChatRuntimeEvent): NewChatRuntimeEvent {
  return NewChatRuntimeEventSchema.parse(event)
}

export function stringifyChatRuntimeEventPayload(payload: Record<string, unknown> | undefined): string {
  return JSON.stringify(payload ?? {})
}

function requireStringField(
  value: string | null | undefined,
  field: string,
  context: z.RefinementCtx,
): void {
  if (typeof value === 'string' && value.length > 0) {
    return
  }
  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: `${field} is required for this chat runtime event type`,
    path: [field],
  })
}

function validateQueueReorderedPayload(
  payload: Record<string, unknown>,
  context: z.RefinementCtx,
): void {
  const positions = payload.positions
  if (!Array.isArray(positions)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'payload.positions is required for queue.item_reordered',
      path: ['payload', 'positions'],
    })
    return
  }
  for (const [index, item] of positions.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'queue reorder position must be an object',
        path: ['payload', 'positions', index],
      })
      continue
    }
    const record = item as Record<string, unknown>
    if (typeof record.queueItemId !== 'string' || record.queueItemId.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'queue reorder position requires queueItemId',
        path: ['payload', 'positions', index, 'queueItemId'],
      })
    }
    if (typeof record.position !== 'number' || !Number.isFinite(record.position)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'queue reorder position requires a finite position',
        path: ['payload', 'positions', index, 'position'],
      })
    }
  }
}

function validateRunProviderContextPayload(
  payload: Record<string, unknown>,
  context: z.RefinementCtx,
): void {
  if (typeof payload.runtimeKind !== 'string' || payload.runtimeKind.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'payload.runtimeKind is required for run provider context events',
      path: ['payload', 'runtimeKind'],
    })
  }
  const backendSessionId = payload.backendSessionId
  if (
    backendSessionId !== undefined
    && backendSessionId !== null
    && typeof backendSessionId !== 'string'
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'payload.backendSessionId must be a string or null',
      path: ['payload', 'backendSessionId'],
    })
  }
  const providerTargetId = payload.providerTargetId
  if (
    providerTargetId !== undefined
    && providerTargetId !== null
    && typeof providerTargetId !== 'string'
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'payload.providerTargetId must be a string or null',
      path: ['payload', 'providerTargetId'],
    })
  }
  const requestedModelId = payload.requestedModelId
  if (
    requestedModelId !== undefined
    && requestedModelId !== null
    && typeof requestedModelId !== 'string'
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'payload.requestedModelId must be a string or null',
      path: ['payload', 'requestedModelId'],
    })
  }
}
