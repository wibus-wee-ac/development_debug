import {
  createBuiltinToolCallInputPayload,
  createBuiltinToolCallResultPayload,
  type BuiltinToolCallInputPayload,
  type BuiltinToolCallResultPayload,
} from '../../tools/tool-call-payload'
import { ClaudeCodeToolIdentifier } from './identity'

export function createClaudeCodeToolInputPayload(apiName: string, args: unknown): BuiltinToolCallInputPayload {
  return createBuiltinToolCallInputPayload({
    identifier: ClaudeCodeToolIdentifier,
    apiName,
    args,
  })
}

export function createClaudeCodeToolResultPayload(input: {
  apiName: string
  args?: unknown
  result: unknown
}): BuiltinToolCallResultPayload {
  return createBuiltinToolCallResultPayload({
    identifier: ClaudeCodeToolIdentifier,
    apiName: input.apiName,
    args: input.args,
    result: input.result,
  })
}
