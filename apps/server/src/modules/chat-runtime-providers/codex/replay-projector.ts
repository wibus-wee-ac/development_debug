import { readReplayTextMessages, stringifyReplayValue } from '../../chat-runtime/replay/event-content'
import { readCradleReplayToolCalls } from '../../chat-runtime/replay/tool-events'
import type {
  ChatRuntimeReplayProjectInput,
  ChatRuntimeReplayProjector,
  ProviderReplayProjection,
} from '../../chat-runtime/replay/types'
import type { ResponseItem as CodexResponseItem } from './app-server-protocol/ResponseItem'
import { CODEX_RUNTIME_KIND } from './metadata'

export class CodexReplayProjector implements ChatRuntimeReplayProjector<CodexResponseItem[]> {
  readonly runtimeKind = CODEX_RUNTIME_KIND

  project(input: ChatRuntimeReplayProjectInput): ProviderReplayProjection<CodexResponseItem[]> {
    const diagnostics: ProviderReplayProjection<CodexResponseItem[]>['diagnostics'] = []
    const output: CodexResponseItem[] = []

    for (const message of readReplayTextMessages(input.events)) {
      output.push({
        type: 'message',
        role: message.role,
        content: [{
          type: message.role === 'assistant' ? 'output_text' : 'input_text',
          text: message.content,
        }],
      })
    }

    for (const call of readCradleReplayToolCalls(input.events)) {
      output.push({
        type: 'function_call',
        name: call.apiName,
        arguments: stringifyReplayValue(call.args ?? {}),
        call_id: call.id,
      })
      if (call.result !== undefined) {
        output.push({
          type: 'function_call_output',
          call_id: call.id,
          output: stringifyReplayValue(call.result),
        })
      }
      diagnostics.push({
        severity: 'info',
        eventId: call.eventIds.at(-1),
        message: `Projected Cradle tool call as Codex replay item: ${call.apiName}`,
      })
    }

    return { output, diagnostics }
  }
}

export const codexReplayProjector = new CodexReplayProjector()
