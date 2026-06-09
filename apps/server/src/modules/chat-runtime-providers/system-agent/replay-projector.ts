import { readReplayTextMessages, stringifyReplayValue } from '../../chat-runtime/replay/event-content'
import { readCradleReplayToolCalls } from '../../chat-runtime/replay/tool-events'
import type {
  ChatRuntimeReplayProjectInput,
  ChatRuntimeReplayProjector,
  ProviderReplayProjection,
} from '../../chat-runtime/replay/types'
import { SYSTEM_AGENT_RUNTIME_KIND } from './metadata'

export interface SystemAgentReplayPrompt {
  prompt: string
}

export class SystemAgentReplayProjector implements ChatRuntimeReplayProjector<SystemAgentReplayPrompt> {
  readonly runtimeKind = SYSTEM_AGENT_RUNTIME_KIND

  project(input: ChatRuntimeReplayProjectInput): ProviderReplayProjection<SystemAgentReplayPrompt> {
    const diagnostics: ProviderReplayProjection<SystemAgentReplayPrompt>['diagnostics'] = []
    const lines: string[] = []

    for (const message of readReplayTextMessages(input.events)) {
      const label = message.role === 'user' ? 'User' : 'Assistant'
      lines.push(`${label}: ${message.content}`)
    }

    for (const call of readCradleReplayToolCalls(input.events)) {
      diagnostics.push({
        severity: 'info',
        eventId: call.eventIds.at(-1),
        message: `Summarized Cradle tool call instead of replaying it as a System Agent tool: ${call.apiName}`,
      })
      lines.push(`Tool summary (${call.apiName}): ${stringifyReplayValue(call.result ?? call.args ?? {})}`)
    }

    return {
      output: { prompt: lines.join('\n').trim() },
      diagnostics,
    }
  }
}

export const systemAgentReplayProjector = new SystemAgentReplayProjector()
