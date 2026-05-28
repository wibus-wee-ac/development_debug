// Output: Structured tool payload projection for Codex app-server item notifications.
// Input: Codex app-server item records emitted during a turn.
// Position: Codex provider helper used by app-server notification mapping.

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
    default:
      return item.type
  }
}

export function buildCodexToolInput(item: CodexAppServerItem): unknown {
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
    default:
      return {}
  }
}

export function buildCodexToolOutput(
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
    default:
      return {}
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
