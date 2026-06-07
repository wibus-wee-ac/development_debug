import type { UIMessage } from 'ai'

const TOOL_TYPE_PREFIX_PATTERN = /^tool-/

type MessagePart = UIMessage['parts'][number]

interface SubagentToolOutput {
  type: 'cradle.subagent-output.v1'
  message: UIMessage
}

export function isToolLikePart(part: MessagePart): part is MessagePart & {
  toolCallId: string
  toolName?: string
  state?: string
  approval?: {
    id?: unknown
    approved?: unknown
    reason?: unknown
  }
  preliminary?: boolean
  argumentsText?: string
  input?: unknown
  output?: unknown
  errorText?: string
} {
  return (part.type === 'dynamic-tool' || part.type.startsWith('tool-'))
    && 'toolCallId' in part
    && typeof part.toolCallId === 'string'
}

export function toolNameFromPart(part: {
  type: string
  toolName?: string
}): string {
  return part.toolName ?? part.type.replace(TOOL_TYPE_PREFIX_PATTERN, '')
}

export function readSubagentOutputMessage(output: unknown): UIMessage | null {
  if (!isSubagentToolOutput(output)) {
    return null
  }
  return output.message
}

function isSubagentToolOutput(output: unknown): output is SubagentToolOutput {
  return typeof output === 'object'
    && output !== null
    && (output as { type?: unknown }).type === 'cradle.subagent-output.v1'
    && isUiMessage((output as { message?: unknown }).message)
}

function isUiMessage(value: unknown): value is UIMessage {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { id?: unknown }).id === 'string'
    && ((value as { role?: unknown }).role === 'assistant' || (value as { role?: unknown }).role === 'user')
    && Array.isArray((value as { parts?: unknown }).parts)
}
