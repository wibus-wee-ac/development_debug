import {
  createBuiltinToolCallInputPayload,
  createBuiltinToolCallResultPayload,
  type BuiltinToolCallInputPayload,
  type BuiltinToolCallResultPayload,
} from '../../tools/tool-call-payload'
import { CodexToolIdentifier } from './identity'

export interface CodexAppServerItem {
  type: string
  id: string
  text?: string
  summary?: string[]
  content?: string[]
  command?: string
  aggregatedOutput?: string | null
  exitCode?: number | null
  changes?: Array<{ path: string }>
  status?: string
  server?: string
  tool?: string
  arguments?: unknown
  result?: { content?: unknown } | null
  error?: { message?: string } | null
  namespace?: string | null
  success?: boolean | null
  contentItems?: Array<{ type: string, text?: string, imageUrl?: string }> | null
  senderThreadId?: string
  receiverThreadIds?: string[]
  agentsStates?: Record<string, { status: string, message?: string | null }>
  prompt?: string | null
  model?: string | null
  query?: string
  action?: { type: string, query?: string | null, url?: string | null, pattern?: string | null } | null
}

export interface CodexAppServerServerRequestItem {
  method: string
  id: number
  params?: unknown
}

export function readCodexToolName(item: CodexAppServerItem): string {
  switch (item.type) {
    case 'commandExecution':
      return 'command_execution'
    case 'fileChange':
      return 'file_change'
    case 'mcpToolCall':
      return `${item.server ?? 'mcp'}/${item.tool ?? 'tool'}`
    case 'dynamicToolCall':
      return item.namespace ? `${item.namespace}/${item.tool ?? 'tool'}` : (item.tool ?? 'dynamic_tool')
    case 'collabAgentToolCall':
      return item.tool ?? 'collab_agent'
    case 'webSearch':
      return 'web_search'
    case 'plan':
      return 'plan'
    case 'imageView':
      return 'image_view'
    case 'imageGeneration':
      return 'image_generation'
    case 'enteredReviewMode':
      return 'review_mode_entered'
    case 'exitedReviewMode':
      return 'review_mode_exited'
    case 'contextCompaction':
      return 'context_compaction'
    default:
      return item.type
  }
}

export function buildCodexToolInput(item: CodexAppServerItem): BuiltinToolCallInputPayload {
  return createBuiltinToolCallInputPayload({
    identifier: CodexToolIdentifier,
    apiName: readCodexToolName(item),
    args: buildCodexToolArgs(item),
  })
}

export function buildCodexToolOutput(
  item: CodexAppServerItem,
  bufferedCommandOutput?: string,
  bufferedCommand?: string,
  args?: unknown,
): BuiltinToolCallResultPayload {
  return createBuiltinToolCallResultPayload({
    identifier: CodexToolIdentifier,
    apiName: readCodexToolName(item),
    args: args ?? buildCodexToolArgsWithBufferedCommand(item, bufferedCommand),
    result: buildCodexToolResult(item, bufferedCommandOutput, bufferedCommand),
  })
}

function buildCodexToolArgsWithBufferedCommand(item: CodexAppServerItem, bufferedCommand?: string): unknown {
  if (item.type === 'commandExecution') {
    return { command: item.command ?? bufferedCommand ?? '' }
  }
  return buildCodexToolArgs(item)
}

export function buildCodexToolArgs(item: CodexAppServerItem): unknown {
  switch (item.type) {
    case 'commandExecution':
      return { command: item.command ?? '' }
    case 'fileChange':
      return { filenames: readChangedPaths(item), status: item.status ?? 'started', type: item.type }
    case 'mcpToolCall':
      return item.arguments ?? { server: item.server, tool: item.tool }
    case 'dynamicToolCall':
      return item.arguments ?? {}
    case 'collabAgentToolCall':
      return {
        tool: item.tool,
        prompt: item.prompt,
        model: item.model,
        senderThreadId: item.senderThreadId,
        receiverThreadIds: item.receiverThreadIds,
      }
    case 'webSearch':
      return { query: item.query ?? '', action: item.action }
    case 'plan':
      return { text: item.text ?? '' }
    case 'imageView':
      return { path: (item as { path?: string }).path ?? '' }
    case 'imageGeneration':
      return {
        status: item.status,
        revisedPrompt: (item as { revisedPrompt?: string | null }).revisedPrompt ?? null,
      }
    case 'enteredReviewMode':
    case 'exitedReviewMode':
      return { review: (item as { review?: string }).review ?? '' }
    case 'contextCompaction':
      return { id: item.id }
    default:
      return {}
  }
}

export function buildCodexToolResult(
  item: CodexAppServerItem,
  bufferedCommandOutput?: string,
  bufferedCommand?: string,
): unknown {
  switch (item.type) {
    case 'commandExecution':
      return {
        command: item.command ?? bufferedCommand ?? '',
        output: item.aggregatedOutput ?? bufferedCommandOutput ?? '',
        exitCode: item.exitCode ?? null,
        code: item.exitCode ?? null,
      }
    case 'fileChange':
      return {
        filenames: readChangedPaths(item),
        status: item.status ?? 'completed',
        type: item.type,
      }
    case 'mcpToolCall':
      return {
        server: item.server,
        tool: item.tool,
        result: item.result ?? null,
        content: item.result?.content ?? null,
      }
    case 'dynamicToolCall':
      return {
        tool: item.tool,
        status: item.status ?? (item.success === false ? 'failed' : 'completed'),
        success: item.success ?? item.status !== 'failed',
        contentItems: item.contentItems ?? null,
        contents: item.contentItems ?? [],
      }
    case 'collabAgentToolCall':
      return {
        tool: item.tool,
        status: item.status,
        agentsStates: item.agentsStates,
        receiverThreadIds: item.receiverThreadIds,
      }
    case 'webSearch':
      return {
        query: item.query,
        action: item.action,
      }
    case 'plan':
      return { plan: item.text ?? '' }
    case 'imageView':
      return { path: (item as { path?: string }).path ?? '' }
    case 'imageGeneration':
      return {
        status: item.status,
        revisedPrompt: (item as { revisedPrompt?: string | null }).revisedPrompt ?? null,
        result: (item as { result?: string }).result ?? '',
        savedPath: (item as { savedPath?: string }).savedPath ?? null,
      }
    case 'enteredReviewMode':
    case 'exitedReviewMode':
      return { review: (item as { review?: string }).review ?? '' }
    case 'contextCompaction':
      return { id: item.id }
    default:
      return {}
  }
}

export function buildCodexServerRequestToolInput(request: CodexAppServerServerRequestItem): BuiltinToolCallInputPayload {
  return createBuiltinToolCallInputPayload({
    identifier: CodexToolIdentifier,
    apiName: readCodexServerRequestToolName(request.method),
    args: request.params ?? {},
  })
}

export function buildCodexServerRequestToolOutput(
  request: CodexAppServerServerRequestItem,
  result: unknown,
): BuiltinToolCallResultPayload {
  return createBuiltinToolCallResultPayload({
    identifier: CodexToolIdentifier,
    apiName: readCodexServerRequestToolName(request.method),
    args: request.params ?? {},
    result,
  })
}

export function readCodexServerRequestToolName(method: string): string {
  switch (method) {
    case 'item/commandExecution/requestApproval':
      return 'approval.command_execution'
    case 'item/fileChange/requestApproval':
      return 'approval.file_change'
    case 'item/tool/requestUserInput':
      return 'tool.request_user_input'
    case 'mcpServer/elicitation/request':
      return 'mcp.elicitation'
    case 'item/permissions/requestApproval':
      return 'approval.permissions'
    case 'item/tool/call':
      return 'dynamic_tool.call'
    case 'account/chatgptAuthTokens/refresh':
      return 'account.chatgpt_auth_tokens.refresh'
    case 'attestation/generate':
      return 'attestation.generate'
    case 'applyPatchApproval':
      return 'approval.apply_patch'
    case 'execCommandApproval':
      return 'approval.exec_command'
    default:
      return method
  }
}

export function readCodexToolError(item: CodexAppServerItem): string | null {
  if (item.error?.message) {
    return item.error.message
  }
  if (item.type === 'dynamicToolCall' && item.status === 'failed') {
    return 'Dynamic tool call failed'
  }
  return null
}

function readChangedPaths(item: CodexAppServerItem): string[] {
  return item.changes?.map(change => change.path) ?? []
}
