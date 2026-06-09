import type { ChatRuntimeEventRecord } from '../events'
import type { CradleReplayToolCall } from './types'

export function readCradleReplayToolCalls(events: ChatRuntimeEventRecord[]): CradleReplayToolCall[] {
  const calls = new Map<string, CradleReplayToolCall>()

  for (const event of events) {
    if (!event.messageId && !event.runId && !event.queueItemId) {
      continue
    }
    if (
      event.type !== 'tool_call.requested'
      && event.type !== 'tool_call.arguments_recorded'
      && event.type !== 'tool_call.result_recorded'
      && event.type !== 'tool_call.user_input_requested'
      && event.type !== 'tool_call.user_input_answered'
    ) {
      continue
    }

    const toolCallId = readString(event.payload.toolCallId) ?? event.messageId ?? event.runId ?? event.id
    const existing = calls.get(toolCallId)
    const identifier = readString(event.payload.identifier) ?? existing?.identifier ?? 'cradle'
    const apiName = readString(event.payload.apiName) ?? existing?.apiName ?? readFallbackApiName(event)
    const args = readToolArgs(event.payload) ?? existing?.args ?? {}
    const result = event.type === 'tool_call.result_recorded' || event.type === 'tool_call.user_input_answered'
      ? readToolResult(event.payload)
      : existing?.result

    calls.set(toolCallId, {
      id: toolCallId,
      identifier,
      apiName,
      args,
      ...(result === undefined ? {} : { result }),
      eventIds: [...(existing?.eventIds ?? []), event.id],
    })
  }

  return Array.from(calls.values())
}

function readToolArgs(payload: Record<string, unknown>): unknown {
  if (payload.args !== undefined) {
    return payload.args
  }
  if (payload.input !== undefined) {
    return payload.input
  }
  if (payload.params !== undefined) {
    return payload.params
  }
  return undefined
}

function readToolResult(payload: Record<string, unknown>): unknown {
  if (payload.result !== undefined) {
    return payload.result
  }
  if (payload.answer !== undefined) {
    return payload.answer
  }
  if (payload.output !== undefined) {
    return payload.output
  }
  return null
}

function readFallbackApiName(event: ChatRuntimeEventRecord): string {
  switch (event.type) {
    case 'tool_call.user_input_requested':
    case 'tool_call.user_input_answered':
      return 'tool.request_user_input'
    default:
      return 'unknown_tool'
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}
