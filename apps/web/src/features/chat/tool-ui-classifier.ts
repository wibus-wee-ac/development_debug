// Input: UIMessage tool part metadata and raw tool input/output values
// Output: Tool UI classification helpers for chat rendering
// Position: Chat feature adapter between AI SDK dynamic-tool parts and visual tool blocks

export type ToolState
  = | 'input-streaming'
    | 'input-available'
    | 'approval-requested'
    | 'approval-responded'
    | 'output-available'
    | 'output-error'
    | 'output-denied'

export type ToolUiKind
  = | 'file-read'
    | 'file-diff'
    | 'notebook-diff'
    | 'terminal'
    | 'search'
    | 'web'
    | 'subagent'
    | 'task-control'
    | 'todo'
    | 'plan'
    | 'question'
    | 'mcp'
    | 'worktree'
    | 'generic'

interface BaseRenderableToolPart {
  type: string
  toolCallId: string
  state: ToolState
  input?: unknown
  output?: unknown
  errorText?: string
}

export type RenderableToolPart
  = | (BaseRenderableToolPart & {
    type: 'dynamic-tool'
    toolName: string
  })
  | (BaseRenderableToolPart & {
    type: `tool-${string}`
    toolName?: string
  })

export interface ToolUiDescriptor {
  kind: ToolUiKind
  toolName: string
  displayName: string
  title: string
  target: string | null
  summary: string | null
}

const TOOL_TYPE_PREFIX_PATTERN = /^tool-/
const FUNCTIONS_PREFIX_PATTERN = /^functions\./
const TOOL_NAME_SEPARATOR_PATTERN = /[-\s]/g
const MCP_PREFIX_PATTERN = /^mcp__/
const DOUBLE_UNDERSCORE_PATTERN = /__/g
const UNDERSCORE_OR_DASH_PATTERN = /[_-]/g
const LOWER_TO_UPPER_PATTERN = /([a-z])([A-Z])/g
const WHITESPACE_PATTERN = /\s+/
const LINE_BREAK_PATTERN = /\r?\n/

export function describeToolCall(part: RenderableToolPart): ToolUiDescriptor {
  const toolName = part.toolName ?? part.type.replace(TOOL_TYPE_PREFIX_PATTERN, '')
  const normalizedName = normalizeToolName(toolName)
  const kind = classifyToolKind(normalizedName, part.input, part.output)
  const displayName = formatToolName(toolName)
  const target = readToolTarget(kind, part.input, part.output)
  return {
    kind,
    toolName,
    displayName,
    title: readToolTitle(kind, displayName, part.input, part.output),
    target,
    summary: readToolSummary(kind, part.input, part.output),
  }
}

export function normalizeToolName(toolName: string): string {
  return toolName
    .trim()
    .replace(TOOL_TYPE_PREFIX_PATTERN, '')
    .replace(FUNCTIONS_PREFIX_PATTERN, '')
    .replace(TOOL_NAME_SEPARATOR_PATTERN, '_')
    .toLowerCase()
}

export function classifyToolKind(toolName: string, input: unknown, output: unknown): ToolUiKind {
  if (isWorktreeTool(toolName)) {
    return 'worktree'
  }
  if (isQuestionTool(toolName, input, output)) {
    return 'question'
  }
  if (isPlanTool(toolName, input, output)) {
    return 'plan'
  }
  if (isTodoTool(toolName, input, output)) {
    return 'todo'
  }
  if (isSubagentTool(toolName, input, output)) {
    return 'subagent'
  }
  if (isTaskControlTool(toolName, input, output)) {
    return 'task-control'
  }
  if (isNotebookTool(toolName, input, output)) {
    return 'notebook-diff'
  }
  if (isDiffTool(toolName, input, output)) {
    return 'file-diff'
  }
  if (isReadTool(toolName, input, output)) {
    return 'file-read'
  }
  if (isTerminalTool(toolName, input, output)) {
    return 'terminal'
  }
  if (isMcpTool(toolName, input, output)) {
    return 'mcp'
  }
  if (isSearchTool(toolName, input, output)) {
    return 'search'
  }
  if (isWebTool(toolName, input, output)) {
    return 'web'
  }
  return 'generic'
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readStringValue(value: unknown, keys: string[]): string | null {
  if (!isRecord(value)) {
    return null
  }
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate
    }
  }
  return null
}

export function readNumberValue(value: unknown, keys: string[]): number | null {
  if (!isRecord(value)) {
    return null
  }
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate
    }
  }
  return null
}

export function readStringArray(value: unknown, keys: string[]): string[] {
  if (!isRecord(value)) {
    return []
  }
  for (const key of keys) {
    const candidate = value[key]
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is string => typeof item === 'string')
    }
  }
  return []
}

export function formatToolName(toolName: string): string {
  const readable = toolName
    .replace(MCP_PREFIX_PATTERN, 'mcp ')
    .replace(DOUBLE_UNDERSCORE_PATTERN, ' / ')
    .replace(UNDERSCORE_OR_DASH_PATTERN, ' ')
    .replace(LOWER_TO_UPPER_PATTERN, '$1 $2')
    .trim()

  if (!readable) {
    return 'Tool'
  }

  return readable
    .split(WHITESPACE_PATTERN)
    .map(word => word === '/' ? word : word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function readToolTitle(kind: ToolUiKind, displayName: string, input: unknown, output: unknown): string {
  const description = readStringValue(input, ['description', 'explanation', 'goal'])
  if (description) {
    return description
  }

  switch (kind) {
    case 'file-read':
      return 'Read file'
    case 'file-diff':
      return readStringValue(output, ['type']) === 'create' ? 'Create file' : 'Edit file'
    case 'notebook-diff':
      return 'Edit notebook'
    case 'terminal':
      return 'Run command'
    case 'search':
      return displayName.includes('Glob') ? 'Find files' : 'Search code'
    case 'web':
      return displayName.includes('Search') ? 'Search web' : 'Fetch web page'
    case 'subagent':
      return 'Run subagent'
    case 'task-control':
      return displayName.includes('Stop') ? 'Stop task' : 'Read task output'
    case 'todo':
      return 'Update todos'
    case 'plan':
      return 'Submit plan'
    case 'question':
      return 'Ask user'
    case 'mcp':
      return displayName
    case 'worktree':
      return displayName.includes('Exit') ? 'Exit worktree' : 'Enter worktree'
    case 'generic':
      return displayName
  }
}

function readToolTarget(kind: ToolUiKind, input: unknown, output: unknown): string | null {
  switch (kind) {
    case 'file-read':
    case 'file-diff':
      return readStringValue(input, ['file_path', 'filePath', 'path', 'file', 'filename'])
        ?? readStringValue(output, ['filePath', 'filename'])
        ?? readNestedString(output, ['file'], ['filePath'])
    case 'notebook-diff':
      return readStringValue(input, ['notebook_path']) ?? readStringValue(output, ['notebook_path'])
    case 'terminal':
      return readFirstLine(readStringValue(input, ['command', 'cmd']) ?? readStringValue(output, ['command']))
    case 'search':
      return readStringValue(input, ['pattern', 'query', 'glob']) ?? readStringValue(output, ['query'])
    case 'web':
      return readStringValue(input, ['url', 'query']) ?? readStringValue(output, ['url', 'query'])
    case 'subagent':
      return readStringValue(input, ['description', 'name', 'subagent_type']) ?? readStringValue(output, ['agentId', 'description'])
    case 'task-control':
      return readStringValue(input, ['task_id', 'shell_id']) ?? readStringValue(output, ['task_id'])
    case 'todo': {
      const count = readTodoCount(input, output)
      return count === null ? null : `${count} item${count === 1 ? '' : 's'}`
    }
    case 'plan':
      return readStringValue(output, ['filePath'])
    case 'question': {
      const count = readQuestionCount(input, output)
      return count === null ? null : `${count} question${count === 1 ? '' : 's'}`
    }
    case 'mcp':
      return readStringValue(input, ['server', 'uri', 'tool']) ?? readStringValue(output, ['server', 'uri'])
    case 'worktree':
      return readStringValue(input, ['path', 'name']) ?? readStringValue(output, ['worktreePath', 'worktreeBranch'])
    case 'generic':
      return readStringValue(input, ['path', 'file_path', 'query', 'command', 'url'])
  }
}

function readToolSummary(kind: ToolUiKind, input: unknown, output: unknown): string | null {
  switch (kind) {
    case 'file-read':
      return readFileReadSummary(output)
    case 'file-diff':
      return readDiffSummary(input, output)
    case 'notebook-diff':
      return readStringValue(output, ['edit_mode', 'cell_type'])
    case 'terminal':
      return readTerminalSummary(output)
    case 'search':
      return readSearchSummary(output)
    case 'web':
      return readWebSummary(output)
    case 'subagent':
      return readSubagentSummary(output)
    case 'task-control':
      return readStringValue(output, ['message'])
    case 'todo':
      return readTodoSummary(input, output)
    case 'plan':
      return readStringValue(output, ['filePath']) ? 'Plan saved' : null
    case 'question':
      return isRecord(output) && isRecord(output.answers) ? 'Answered' : null
    case 'mcp':
      return readMcpSummary(output)
    case 'worktree':
      return readStringValue(output, ['message'])
    case 'generic':
      return null
  }
}

function isReadTool(toolName: string, input: unknown, output: unknown): boolean {
  return toolName === 'read'
    || toolName === 'read_file'
    || toolName === 'fileread'
    || toolName === 'file_read'
    || readNestedString(output, ['file'], ['filePath']) !== null
    || readStringValue(input, ['pages']) !== null
}

function isDiffTool(toolName: string, input: unknown, output: unknown): boolean {
  return toolName === 'edit'
    || toolName === 'edit_file'
    || toolName === 'fileedit'
    || toolName === 'file_edit'
    || toolName === 'write'
    || toolName === 'write_file'
    || toolName === 'filewrite'
    || toolName === 'file_write'
    || toolName === 'multiedit'
    || toolName === 'multi_edit'
    || toolName === 'multi_edit_file'
    || toolName === 'multi_file_edit'
    || (isRecord(output) && (Array.isArray(output.structuredPatch) || isRecord(output.gitDiff)))
    || readStringValue(input, ['old_string', 'new_string', 'content']) !== null
}

function isNotebookTool(toolName: string, input: unknown, output: unknown): boolean {
  return toolName === 'notebookedit'
    || toolName === 'notebook_edit'
    || readStringValue(input, ['notebook_path']) !== null
    || readStringValue(output, ['notebook_path']) !== null
}

function isTerminalTool(toolName: string, input: unknown, output: unknown): boolean {
  return toolName === 'bash'
    || toolName === 'terminal'
    || toolName === 'run_command'
    || toolName === 'execute'
    || toolName === 'command_execution'
    || readStringValue(input, ['command', 'cmd']) !== null
    || readStringValue(output, ['stdout', 'stderr']) !== null
}

function isSearchTool(toolName: string, input: unknown, output: unknown): boolean {
  return toolName === 'grep'
    || toolName === 'glob'
    || toolName === 'search'
    || toolName === 'file_search'
    || (readStringValue(input, ['pattern', 'glob']) !== null && !isWebTool(toolName, input, output))
    || readStringArray(output, ['filenames']).length > 0
}

function isWebTool(toolName: string, input: unknown, output: unknown): boolean {
  return toolName === 'webfetch'
    || toolName === 'web_fetch'
    || toolName === 'websearch'
    || toolName === 'web_search'
    || readStringValue(input, ['url']) !== null
    || (readStringValue(input, ['query']) !== null && isRecord(output) && ('results' in output || 'durationSeconds' in output))
}

function isSubagentTool(toolName: string, input: unknown, output: unknown): boolean {
  return toolName === 'agent'
    || toolName === 'task'
    || toolName === 'spawn_agent'
    || readStringValue(input, ['subagent_type', 'team_name']) !== null
    || readStringValue(output, ['agentId', 'agentType']) !== null
}

function isTaskControlTool(toolName: string, input: unknown, output: unknown): boolean {
  return toolName === 'taskoutput'
    || toolName === 'task_output'
    || toolName === 'taskstop'
    || toolName === 'task_stop'
    || toolName === 'taskstatus'
    || toolName === 'task_status'
    || toolName === 'sendmessage'
    || toolName === 'send_message'
    || readStringValue(input, ['task_id', 'shell_id']) !== null
    || readStringValue(output, ['task_id', 'task_type']) !== null
}

function isTodoTool(toolName: string, input: unknown, output: unknown): boolean {
  return toolName === 'todowrite'
    || toolName === 'todo_write'
    || readTodoCount(input, output) !== null
}

function isPlanTool(toolName: string, input: unknown, output: unknown): boolean {
  return toolName === 'exitplanmode'
    || toolName === 'exit_plan_mode'
    || readStringValue(output, ['plan']) !== null
    || (isRecord(input) && Array.isArray(input.allowedPrompts))
}

function isQuestionTool(toolName: string, input: unknown, output: unknown): boolean {
  return toolName === 'askuserquestion'
    || toolName === 'ask_user_question'
    || readQuestionCount(input, output) !== null
}

function isMcpTool(toolName: string, input: unknown, output: unknown): boolean {
  return toolName.startsWith('mcp__')
    || toolName.includes('/')
    || toolName === 'mcp'
    || toolName === 'listmcpresources'
    || toolName === 'list_mcp_resources'
    || toolName === 'readmcpresource'
    || toolName === 'read_mcp_resource'
    || readStringValue(input, ['server', 'uri']) !== null
    || (Array.isArray(output) && output.some(item => isRecord(item) && typeof item.uri === 'string'))
}

function isWorktreeTool(toolName: string): boolean {
  return toolName === 'enterworktree'
    || toolName === 'enter_worktree'
    || toolName === 'exitworktree'
    || toolName === 'exit_worktree'
}

function readNestedString(value: unknown, parentKeys: string[], childKeys: string[]): string | null {
  if (!isRecord(value)) {
    return null
  }
  for (const parentKey of parentKeys) {
    const parent = value[parentKey]
    const child = readStringValue(parent, childKeys)
    if (child) {
      return child
    }
  }
  return null
}

function readFirstLine(value: string | null): string | null {
  if (!value) {
    return null
  }
  return value.split(LINE_BREAK_PATTERN, 1)[0] ?? value
}

function readFileReadSummary(output: unknown): string | null {
  if (!isRecord(output)) {
    return null
  }
  const type = typeof output.type === 'string' ? output.type : null
  const file = isRecord(output.file) ? output.file : null
  if (type === 'text' && file) {
    const lines = readNumberValue(file, ['numLines'])
    const total = readNumberValue(file, ['totalLines'])
    if (lines !== null && total !== null) {
      return `${lines}/${total} lines`
    }
    if (lines !== null) {
      return `${lines} lines`
    }
  }
  if (type === 'image') {
    return 'Image preview'
  }
  if (type === 'pdf') {
    return 'PDF preview'
  }
  if (type === 'notebook') {
    return 'Notebook cells'
  }
  if (type === 'parts' && file) {
    const count = readNumberValue(file, ['count'])
    return count === null ? 'Extracted pages' : `${count} pages`
  }
  if (type === 'file_unchanged') {
    return 'File unchanged'
  }
  return null
}

function readDiffSummary(input: unknown, output: unknown): string | null {
  const additions = readNestedNumber(output, ['gitDiff'], ['additions'])
  const deletions = readNestedNumber(output, ['gitDiff'], ['deletions'])
  if (additions !== null || deletions !== null) {
    return `+${additions ?? 0} -${deletions ?? 0}`
  }
  const patch = isRecord(output) && Array.isArray(output.structuredPatch) ? output.structuredPatch : null
  if (patch) {
    return `${patch.length} hunk${patch.length === 1 ? '' : 's'}`
  }
  if (readStringValue(input, ['content']) !== null) {
    return 'Write content'
  }
  return null
}

function readNestedNumber(value: unknown, parentKeys: string[], childKeys: string[]): number | null {
  if (!isRecord(value)) {
    return null
  }
  for (const parentKey of parentKeys) {
    const parent = value[parentKey]
    const child = readNumberValue(parent, childKeys)
    if (child !== null) {
      return child
    }
  }
  return null
}

function readTerminalSummary(output: unknown): string | null {
  if (!isRecord(output)) {
    return null
  }
  const backgroundTaskId = readStringValue(output, ['backgroundTaskId'])
  if (backgroundTaskId) {
    return `Background task ${backgroundTaskId}`
  }
  if (output.interrupted === true) {
    return 'Interrupted'
  }
  const stdout = readStringValue(output, ['stdout'])
  const stderr = readStringValue(output, ['stderr'])
  if (stderr) {
    return 'stderr available'
  }
  if (stdout) {
    return 'stdout available'
  }
  if (output.noOutputExpected === true) {
    return 'No output expected'
  }
  return null
}

function readSearchSummary(output: unknown): string | null {
  const files = readNumberValue(output, ['numFiles'])
  const matches = readNumberValue(output, ['numMatches'])
  if (files !== null && matches !== null) {
    return `${matches} matches in ${files} files`
  }
  if (files !== null) {
    return `${files} file${files === 1 ? '' : 's'}`
  }
  return null
}

function readWebSummary(output: unknown): string | null {
  if (!isRecord(output)) {
    return null
  }
  const code = readNumberValue(output, ['code'])
  const bytes = readNumberValue(output, ['bytes'])
  if (code !== null && bytes !== null) {
    return `${code} · ${formatBytes(bytes)}`
  }
  const seconds = readNumberValue(output, ['durationSeconds'])
  if (seconds !== null) {
    return `${seconds.toFixed(1)}s`
  }
  return null
}

function readSubagentSummary(output: unknown): string | null {
  if (!isRecord(output)) {
    return null
  }
  const status = readStringValue(output, ['status'])
  if (status === 'async_launched') {
    return 'Running in background'
  }
  const totalToolUseCount = readNumberValue(output, ['totalToolUseCount'])
  const totalTokens = readNumberValue(output, ['totalTokens'])
  if (totalToolUseCount !== null && totalTokens !== null) {
    return `${totalToolUseCount} tools · ${totalTokens} tokens`
  }
  return status
}

function readTodoCount(input: unknown, output: unknown): number | null {
  if (isRecord(output) && Array.isArray(output.newTodos)) {
    return output.newTodos.length
  }
  if (isRecord(input) && Array.isArray(input.todos)) {
    return input.todos.length
  }
  return null
}

function readTodoSummary(input: unknown, output: unknown): string | null {
  const count = readTodoCount(input, output)
  if (count === null) {
    return null
  }
  return `${count} todo${count === 1 ? '' : 's'}`
}

function readQuestionCount(input: unknown, output: unknown): number | null {
  if (isRecord(output) && Array.isArray(output.questions)) {
    return output.questions.length
  }
  if (isRecord(input) && Array.isArray(input.questions)) {
    return input.questions.length
  }
  return null
}

function readMcpSummary(output: unknown): string | null {
  if (Array.isArray(output)) {
    return `${output.length} resource${output.length === 1 ? '' : 's'}`
  }
  if (isRecord(output) && Array.isArray(output.contents)) {
    return `${output.contents.length} content block${output.contents.length === 1 ? '' : 's'}`
  }
  return typeof output === 'string' && output.length > 0 ? 'Tool result' : null
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
