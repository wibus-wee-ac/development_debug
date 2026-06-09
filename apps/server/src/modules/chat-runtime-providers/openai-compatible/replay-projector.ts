import { readReplayTextMessages, stringifyReplayValue } from '../../chat-runtime/replay/event-content'
import { readCradleReplayToolCalls } from '../../chat-runtime/replay/tool-events'
import type {
  ChatRuntimeReplayProjectInput,
  ChatRuntimeReplayProjector,
  ProviderReplayProjection,
} from '../../chat-runtime/replay/types'

export interface OpenAICompatibleReplayMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolName?: string
}

export class OpenAICompatibleReplayProjector implements ChatRuntimeReplayProjector<OpenAICompatibleReplayMessage[]> {
  readonly runtimeKind = 'standard' as const

  project(input: ChatRuntimeReplayProjectInput): ProviderReplayProjection<OpenAICompatibleReplayMessage[]> {
    const diagnostics: ProviderReplayProjection<OpenAICompatibleReplayMessage[]>['diagnostics'] = []
    const output: OpenAICompatibleReplayMessage[] = []

    for (const message of readReplayTextMessages(input.events)) {
      output.push({ role: message.role, content: message.content })
    }

    for (const call of readCradleReplayToolCalls(input.events)) {
      const toolName = projectOpenAIToolName(call.apiName)
      if (!toolName) {
        diagnostics.push({
          severity: 'warning',
          eventId: call.eventIds.at(-1),
          message: `Omitted Cradle tool call with unsupported OpenAI-compatible name: ${call.apiName}`,
        })
        continue
      }
      output.push({
        role: 'tool',
        toolName,
        content: stringifyReplayValue(call.result ?? call.args ?? {}),
      })
    }

    return { output, diagnostics }
  }
}

export function projectOpenAIToolName(name: string): string | null {
  if (isCradleInternalToolName(name)) {
    return null
  }
  const sanitized = name.replace(/[^A-Za-z0-9_-]/g, '_')
  if (!sanitized || sanitized.length > 64) {
    return null
  }
  return sanitized
}

function isCradleInternalToolName(name: string): boolean {
  return name === 'tool.request_user_input'
    || name.startsWith('approval.')
    || name.startsWith('mcp.')
    || name.startsWith('server_request_')
}

export const openAICompatibleReplayProjector = new OpenAICompatibleReplayProjector()
