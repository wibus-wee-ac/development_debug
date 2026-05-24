import { z } from 'zod'

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
  argumentsText?: string
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

const NullableStringSchema = z.string().nullable().optional().default(null)
const NullableNumberSchema = z.number().finite().nullable().optional().default(null)
const NullableBooleanSchema = z.boolean().nullable().optional().default(null)
const StringListSchema = z.array(z.string()).optional().default([])

const ToolContentBlockSchema = z.object({
  text: NullableStringSchema,
  title: NullableStringSchema,
  url: NullableStringSchema,
  uri: NullableStringSchema,
}).passthrough()

function emptyToolContentValue(): { text: string | null, blocks: ToolContentBlock[] } {
  return { text: null, blocks: [] }
}

const ToolContentValueSchema = z.union([
  z.string().transform(value => ({ text: value, blocks: [] as ToolContentBlock[] })),
  z.array(ToolContentBlockSchema).transform(value => ({ text: null, blocks: value })),
  z.null().transform(() => ({ text: null, blocks: [] as ToolContentBlock[] })),
]).optional().transform(value => value ?? emptyToolContentValue())

const ToolFileSchema = z.object({
  filePath: NullableStringSchema,
  type: NullableStringSchema,
  base64: NullableStringSchema,
  content: NullableStringSchema,
  originalSize: NullableNumberSchema,
  count: NullableNumberSchema,
  outputDir: NullableStringSchema,
  numLines: NullableNumberSchema,
  totalLines: NullableNumberSchema,
}).passthrough()

const ToolFileValueSchema = z.union([
  z.string().transform(value => ({ path: value, file: null as ToolFile | null })),
  ToolFileSchema.transform(value => ({ path: value.filePath, file: value })),
  z.null().transform(() => ({ path: null, file: null as ToolFile | null })),
]).optional().transform(value => value ?? ({ path: null, file: null as ToolFile | null }))

const ToolGitDiffSchema = z.object({
  additions: z.number().default(0),
  deletions: z.number().default(0),
  patch: z.string().default(''),
}).passthrough()

const ToolPatchHunkSchema = z.object({
  lines: StringListSchema,
}).passthrough()

const ToolTodoSchema = z.object({
  content: NullableStringSchema,
  activeForm: NullableStringSchema,
  status: NullableStringSchema,
}).passthrough()

const ToolWebResultSchema = z.object({
  content: z.array(ToolContentBlockSchema).optional().default([]),
}).passthrough()

const ToolObjectPayloadSchema = z.object({
  input: NullableStringSchema,
  description: NullableStringSchema,
  explanation: NullableStringSchema,
  goal: NullableStringSchema,
  type: NullableStringSchema,
  file_path: NullableStringSchema,
  filePath: NullableStringSchema,
  path: NullableStringSchema,
  file: ToolFileValueSchema,
  filename: NullableStringSchema,
  notebook_path: NullableStringSchema,
  command: NullableStringSchema,
  cmd: NullableStringSchema,
  timeout: NullableNumberSchema,
  pattern: NullableStringSchema,
  query: NullableStringSchema,
  glob: NullableStringSchema,
  url: NullableStringSchema,
  name: NullableStringSchema,
  subagent_type: NullableStringSchema,
  team_name: NullableStringSchema,
  agentId: NullableStringSchema,
  agentType: NullableStringSchema,
  task_id: NullableStringSchema,
  shell_id: NullableStringSchema,
  task_type: NullableStringSchema,
  plan: NullableStringSchema,
  server: NullableStringSchema,
  uri: NullableStringSchema,
  tool: NullableStringSchema,
  worktreePath: NullableStringSchema,
  worktreeBranch: NullableStringSchema,
  action: NullableStringSchema,
  edit_mode: NullableStringSchema,
  cell_type: NullableStringSchema,
  message: NullableStringSchema,
  stdout: NullableStringSchema,
  stderr: NullableStringSchema,
  output: NullableStringSchema,
  result: NullableStringSchema,
  content: ToolContentValueSchema,
  text: NullableStringSchema,
  backgroundTaskId: NullableStringSchema,
  interrupted: NullableBooleanSchema,
  noOutputExpected: NullableBooleanSchema,
  numFiles: NullableNumberSchema,
  numMatches: NullableNumberSchema,
  code: NullableNumberSchema,
  bytes: NullableNumberSchema,
  durationSeconds: NullableNumberSchema,
  status: NullableStringSchema,
  totalToolUseCount: NullableNumberSchema,
  totalTokens: NullableNumberSchema,
  pages: NullableStringSchema,
  old_string: NullableStringSchema,
  oldString: NullableStringSchema,
  new_string: NullableStringSchema,
  newString: NullableStringSchema,
  originalFile: NullableStringSchema,
  original_file: NullableStringSchema,
  replace_all: NullableBooleanSchema,
  replaceAll: NullableBooleanSchema,
  userModified: NullableBooleanSchema,
  structuredPatch: z.array(ToolPatchHunkSchema).optional().default([]),
  gitDiff: ToolGitDiffSchema.default({
    additions: 0,
    deletions: 0,
    patch: '',
  }),
  filenames: StringListSchema,
  results: z.array(ToolWebResultSchema).optional().default([]),
  contents: z.array(ToolContentBlockSchema).optional().default([]),
  outputFile: NullableStringSchema,
  newTodos: z.array(ToolTodoSchema).optional().default([]),
  todos: z.array(ToolTodoSchema).optional().default([]),
  questions: z.array(z.unknown()).optional().default([]),
  allowedPrompts: z.array(z.unknown()).optional().default([]),
  answers: z.record(z.string(), z.unknown()).nullable().optional().default(null),
  mode: NullableStringSchema,
}).passthrough()

type ToolContentBlock = z.infer<typeof ToolContentBlockSchema>
type ToolFile = z.infer<typeof ToolFileSchema>
type ToolObjectPayload = z.infer<typeof ToolObjectPayloadSchema>

export interface ToolPayload {
  rawText: string | null
  inputText: string | null
  description: string | null
  type: string | null
  filePath: string | null
  notebookPath: string | null
  command: string | null
  timeout: number | null
  pattern: string | null
  query: string | null
  url: string | null
  subagentName: string | null
  agentId: string | null
  agentType: string | null
  taskId: string | null
  taskType: string | null
  plan: string | null
  mcpTarget: string | null
  worktreeTarget: string | null
  worktreeBranch: string | null
  action: string | null
  editMode: string | null
  cellType: string | null
  message: string | null
  stdout: string | null
  stderr: string | null
  outputText: string | null
  contentText: string | null
  text: string | null
  backgroundTaskId: string | null
  interrupted: boolean | null
  noOutputExpected: boolean | null
  numFiles: number | null
  numMatches: number | null
  code: number | null
  bytes: number | null
  durationSeconds: number | null
  status: string | null
  totalToolUseCount: number | null
  totalTokens: number | null
  pages: string | null
  oldString: string | null
  newString: string | null
  originalFile: string | null
  replaceAll: boolean | null
  userModified: boolean | null
  file: ToolFile | null
  gitDiff: z.infer<typeof ToolGitDiffSchema>
  structuredPatch: Array<z.infer<typeof ToolPatchHunkSchema>>
  filenames: string[]
  results: Array<z.infer<typeof ToolWebResultSchema>>
  contentBlocks: ToolContentBlock[]
  contents: ToolContentBlock[]
  outputFile: string | null
  todos: Array<z.infer<typeof ToolTodoSchema>>
  newTodos: Array<z.infer<typeof ToolTodoSchema>>
  questions: unknown[]
  allowedPrompts: unknown[]
  answers: Record<string, unknown> | null
  mode: string | null
}

function toolPayloadFromObject(value: ToolObjectPayload): ToolPayload {
  return {
    rawText: null,
    inputText: value.input,
    description: value.description ?? value.explanation ?? value.goal,
    type: value.type,
    filePath: value.file_path ?? value.filePath ?? value.path ?? value.file.path ?? value.filename,
    notebookPath: value.notebook_path,
    command: value.command ?? value.cmd,
    timeout: value.timeout,
    pattern: value.pattern ?? value.query ?? value.glob,
    query: value.query,
    url: value.url,
    subagentName: value.name ?? value.subagent_type ?? value.team_name,
    agentId: value.agentId,
    agentType: value.agentType,
    taskId: value.task_id ?? value.shell_id,
    taskType: value.task_type,
    plan: value.plan,
    mcpTarget: value.server ?? value.uri ?? value.tool,
    worktreeTarget: value.path ?? value.name ?? value.worktreePath ?? value.worktreeBranch,
    worktreeBranch: value.worktreeBranch,
    action: value.action,
    editMode: value.edit_mode,
    cellType: value.cell_type,
    message: value.message,
    stdout: value.stdout,
    stderr: value.stderr,
    outputText: value.output ?? value.result,
    contentText: value.content.text,
    text: value.text,
    backgroundTaskId: value.backgroundTaskId,
    interrupted: value.interrupted,
    noOutputExpected: value.noOutputExpected,
    numFiles: value.numFiles,
    numMatches: value.numMatches,
    code: value.code,
    bytes: value.bytes,
    durationSeconds: value.durationSeconds,
    status: value.status,
    totalToolUseCount: value.totalToolUseCount,
    totalTokens: value.totalTokens,
    pages: value.pages,
    oldString: value.old_string ?? value.oldString,
    newString: value.new_string ?? value.newString,
    originalFile: value.originalFile ?? value.original_file,
    replaceAll: value.replace_all ?? value.replaceAll,
    userModified: value.userModified,
    file: value.file.file,
    gitDiff: value.gitDiff,
    structuredPatch: value.structuredPatch,
    filenames: value.filenames,
    results: value.results,
    contentBlocks: value.content.blocks,
    contents: value.contents,
    outputFile: value.outputFile,
    todos: value.todos,
    newTodos: value.newTodos,
    questions: value.questions,
    allowedPrompts: value.allowedPrompts,
    answers: value.answers,
    mode: value.mode,
  }
}

export const ToolPayloadSchema = z.union([
  z.string().transform((value): ToolPayload => ({
    ...toolPayloadFromObject(ToolObjectPayloadSchema.parse({})),
    rawText: value,
  })),
  z.array(ToolContentBlockSchema).transform((value): ToolPayload => toolPayloadFromObject(ToolObjectPayloadSchema.parse({ contents: value }))),
  ToolObjectPayloadSchema.transform(toolPayloadFromObject),
  z.null().transform((): ToolPayload => toolPayloadFromObject(ToolObjectPayloadSchema.parse({}))),
  z.undefined().transform((): ToolPayload => toolPayloadFromObject(ToolObjectPayloadSchema.parse({}))),
])

export function readToolInputPayload(input: unknown, argumentsText?: string): ToolPayload {
  const inputPayload = ToolPayloadSchema.parse(input)
  if (input !== undefined || argumentsText === undefined) {
    return inputPayload
  }

  const argumentsObject = parsePartialJsonObject(argumentsText)
  const argumentsPayload = ToolPayloadSchema.parse(argumentsObject)
  return {
    ...argumentsPayload,
    rawText: argumentsText,
    inputText: argumentsText,
  }
}

export function describeToolCall(part: RenderableToolPart): ToolUiDescriptor {
  const toolName = part.toolName ?? part.type.replace(TOOL_TYPE_PREFIX_PATTERN, '')
  const input = readToolInputPayload(part.input, part.argumentsText)
  const output = ToolPayloadSchema.parse(part.output)
  const normalizedName = normalizeToolName(toolName)
  const kind = classifyToolKind(normalizedName, input, output)
  const displayName = formatToolName(toolName)
  const target = readToolTarget(kind, input, output)
  return {
    kind,
    toolName,
    displayName,
    title: readToolTitle(kind, displayName, input, output),
    target,
    summary: readToolSummary(kind, input, output),
  }
}

function parsePartialJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  if (!trimmed) {
    return {}
  }

  try {
    const parsed = JSON.parse(trimmed)
    return z.record(z.string(), z.unknown()).parse(parsed)
  }
  catch {
    return parseTopLevelObjectPrefix(trimmed)
  }
}

function parseTopLevelObjectPrefix(text: string): Record<string, unknown> {
  if (!text.startsWith('{')) {
    return {}
  }

  const object: Record<string, unknown> = {}
  let index = 1
  while (index < text.length) {
    index = skipJsonSeparators(text, index)
    if (text[index] === '}') {
      break
    }
    if (text[index] !== '"') {
      break
    }

    const key = readJsonString(text, index)
    if (!key.complete) {
      break
    }
    index = skipJsonWhitespace(text, key.next)
    if (text[index] !== ':') {
      break
    }
    index = skipJsonWhitespace(text, index + 1)

    const value = readJsonValue(text, index)
    if (value.read) {
      object[key.value] = value.value
    }
    index = value.next
    if (!value.complete) {
      break
    }
  }

  return object
}

function skipJsonSeparators(text: string, index: number): number {
  let nextIndex = skipJsonWhitespace(text, index)
  while (text[nextIndex] === ',') {
    nextIndex = skipJsonWhitespace(text, nextIndex + 1)
  }
  return nextIndex
}

function skipJsonWhitespace(text: string, index: number): number {
  let nextIndex = index
  while (/\s/.test(text[nextIndex] ?? '')) {
    nextIndex += 1
  }
  return nextIndex
}

function readJsonString(text: string, start: number): { value: string, next: number, complete: boolean } {
  let escaped = false
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      return {
        value: JSON.parse(text.slice(start, index + 1)) as string,
        next: index + 1,
        complete: true,
      }
    }
  }

  return {
    value: readPartialJsonStringText(text, start),
    next: text.length,
    complete: false,
  }
}

function readPartialJsonStringText(text: string, start: number): string {
  let value = ''
  let escaped = false
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index]
    if (escaped) {
      value += readEscapedJsonChar(char)
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      break
    }
    value += char
  }
  return value
}

function readEscapedJsonChar(char: string): string {
  switch (char) {
    case '"':
    case '\\':
    case '/':
      return char
    case 'b':
      return '\b'
    case 'f':
      return '\f'
    case 'n':
      return '\n'
    case 'r':
      return '\r'
    case 't':
      return '\t'
    case 'u':
      return ''
    default:
      return char
  }
}

function readJsonValue(text: string, start: number): { value: unknown, next: number, complete: boolean, read: boolean } {
  const first = text[start]
  if (first === '"') {
    const value = readJsonString(text, start)
    return { value: value.value, next: value.next, complete: value.complete, read: true }
  }
  if (first === '{' || first === '[') {
    return readJsonContainer(text, start)
  }

  const tokenEnd = readPrimitiveEnd(text, start)
  const token = text.slice(start, tokenEnd).trim()
  if (!token) {
    return { value: undefined, next: tokenEnd, complete: false, read: false }
  }

  if (token === 'true' || token === 'false' || token === 'null' || /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(token)) {
    return {
      value: JSON.parse(token),
      next: tokenEnd,
      complete: tokenEnd < text.length,
      read: true,
    }
  }

  return { value: undefined, next: tokenEnd, complete: false, read: false }
}

function readPrimitiveEnd(text: string, start: number): number {
  let index = start
  while (index < text.length && text[index] !== ',' && text[index] !== '}') {
    index += 1
  }
  return index
}

function readJsonContainer(text: string, start: number): { value: unknown, next: number, complete: boolean, read: boolean } {
  const opening = text[start]
  const stack = [opening]
  let inString = false
  let escaped = false

  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      }
      else if (char === '\\') {
        escaped = true
      }
      else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{' || char === '[') {
      stack.push(char)
      continue
    }
    if (char === '}' || char === ']') {
      const previous = stack.pop()
      if ((previous === '{' && char !== '}') || (previous === '[' && char !== ']')) {
        break
      }
      if (stack.length === 0) {
        return {
          value: JSON.parse(text.slice(start, index + 1)),
          next: index + 1,
          complete: true,
          read: true,
        }
      }
    }
  }

  return { value: undefined, next: text.length, complete: false, read: false }
}

export function normalizeToolName(toolName: string): string {
  return toolName
    .trim()
    .replace(TOOL_TYPE_PREFIX_PATTERN, '')
    .replace(FUNCTIONS_PREFIX_PATTERN, '')
    .replace(TOOL_NAME_SEPARATOR_PATTERN, '_')
    .toLowerCase()
}

export function classifyToolKind(toolName: string, input: ToolPayload, output: ToolPayload): ToolUiKind {
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

function readToolTitle(kind: ToolUiKind, displayName: string, input: ToolPayload, output: ToolPayload): string {
  const description = input.description
  if (description) {
    return description
  }

  switch (kind) {
    case 'file-read':
      return 'Read file'
    case 'file-diff':
      return output.type === 'create' ? 'Create file' : 'Edit file'
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

function readToolTarget(kind: ToolUiKind, input: ToolPayload, output: ToolPayload): string | null {
  switch (kind) {
    case 'file-read':
    case 'file-diff':
      return input.filePath ?? output.filePath
    case 'notebook-diff':
      return input.notebookPath ?? output.notebookPath
    case 'terminal':
      return readFirstLine(input.command ?? output.command)
    case 'search':
      return input.pattern ?? output.query
    case 'web':
      return input.url ?? input.query ?? output.url ?? output.query
    case 'subagent':
      return input.subagentName ?? output.agentId ?? output.description
    case 'task-control':
      return input.taskId ?? output.taskId
    case 'todo': {
      const count = readTodoCount(input, output)
      return count === null ? null : `${count} item${count === 1 ? '' : 's'}`
    }
    case 'plan':
      return output.filePath
    case 'question': {
      const count = readQuestionCount(input, output)
      return count === null ? null : `${count} question${count === 1 ? '' : 's'}`
    }
    case 'mcp':
      return input.mcpTarget ?? output.mcpTarget
    case 'worktree':
      return input.worktreeTarget ?? output.worktreeTarget
    case 'generic':
      return input.filePath ?? input.query ?? input.command ?? input.url
  }
}

function readToolSummary(kind: ToolUiKind, input: ToolPayload, output: ToolPayload): string | null {
  switch (kind) {
    case 'file-read':
      return readFileReadSummary(output)
    case 'file-diff':
      return readDiffSummary(input, output)
    case 'notebook-diff':
      return output.editMode ?? output.cellType
    case 'terminal':
      return readTerminalSummary(output)
    case 'search':
      return readSearchSummary(output)
    case 'web':
      return readWebSummary(output)
    case 'subagent':
      return readSubagentSummary(output)
    case 'task-control':
      return output.message
    case 'todo':
      return readTodoSummary(input, output)
    case 'plan':
      return output.filePath ? 'Plan saved' : null
    case 'question':
      return output.answers ? 'Answered' : null
    case 'mcp':
      return readMcpSummary(output)
    case 'worktree':
      return output.message
    case 'generic':
      return null
  }
}

function isReadTool(toolName: string, input: ToolPayload, output: ToolPayload): boolean {
  return toolName === 'read'
    || toolName === 'read_file'
    || toolName === 'fileread'
    || toolName === 'file_read'
    || output.filePath !== null
    || input.pages !== null
}

function isDiffTool(toolName: string, input: ToolPayload, output: ToolPayload): boolean {
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
    || output.structuredPatch.length > 0
    || output.gitDiff.additions !== 0
    || output.gitDiff.deletions !== 0
    || output.gitDiff.patch.length > 0
    || input.oldString !== null
    || input.newString !== null
    || input.contentText !== null
}

function isNotebookTool(toolName: string, input: ToolPayload, output: ToolPayload): boolean {
  return toolName === 'notebookedit'
    || toolName === 'notebook_edit'
    || input.notebookPath !== null
    || output.notebookPath !== null
}

function isTerminalTool(toolName: string, input: ToolPayload, output: ToolPayload): boolean {
  return toolName === 'bash'
    || toolName === 'terminal'
    || toolName === 'run_command'
    || toolName === 'execute'
    || toolName === 'command_execution'
    || input.command !== null
    || output.stdout !== null
    || output.stderr !== null
}

function isSearchTool(toolName: string, input: ToolPayload, output: ToolPayload): boolean {
  return toolName === 'grep'
    || toolName === 'glob'
    || toolName === 'search'
    || toolName === 'file_search'
    || (input.pattern !== null && !isWebTool(toolName, input, output))
    || output.filenames.length > 0
}

function isWebTool(toolName: string, input: ToolPayload, output: ToolPayload): boolean {
  return toolName === 'webfetch'
    || toolName === 'web_fetch'
    || toolName === 'websearch'
    || toolName === 'web_search'
    || input.url !== null
    || (input.query !== null && (output.results.length > 0 || output.durationSeconds !== null))
}

function isSubagentTool(toolName: string, input: ToolPayload, output: ToolPayload): boolean {
  return toolName === 'agent'
    || toolName === 'task'
    || toolName === 'spawn_agent'
    || input.subagentName !== null
    || output.agentId !== null
    || output.agentType !== null
}

function isTaskControlTool(toolName: string, input: ToolPayload, output: ToolPayload): boolean {
  return toolName === 'taskoutput'
    || toolName === 'task_output'
    || toolName === 'taskstop'
    || toolName === 'task_stop'
    || toolName === 'taskstatus'
    || toolName === 'task_status'
    || toolName === 'sendmessage'
    || toolName === 'send_message'
    || input.taskId !== null
    || output.taskId !== null
    || output.taskType !== null
}

function isTodoTool(toolName: string, input: ToolPayload, output: ToolPayload): boolean {
  return toolName === 'todowrite'
    || toolName === 'todo_write'
    || readTodoCount(input, output) !== null
}

function isPlanTool(toolName: string, input: ToolPayload, output: ToolPayload): boolean {
  return toolName === 'exitplanmode'
    || toolName === 'exit_plan_mode'
    || output.plan !== null
    || input.allowedPrompts.length > 0
}

function isQuestionTool(toolName: string, input: ToolPayload, output: ToolPayload): boolean {
  return toolName === 'askuserquestion'
    || toolName === 'ask_user_question'
    || readQuestionCount(input, output) !== null
}

function isMcpTool(toolName: string, input: ToolPayload, output: ToolPayload): boolean {
  return toolName.startsWith('mcp__')
    || toolName.includes('/')
    || toolName === 'mcp'
    || toolName === 'listmcpresources'
    || toolName === 'list_mcp_resources'
    || toolName === 'readmcpresource'
    || toolName === 'read_mcp_resource'
    || input.mcpTarget !== null
    || output.contents.length > 0
}

function isWorktreeTool(toolName: string): boolean {
  return toolName === 'enterworktree'
    || toolName === 'enter_worktree'
    || toolName === 'exitworktree'
    || toolName === 'exit_worktree'
}

function readFirstLine(value: string | null): string | null {
  if (!value) {
    return null
  }
  return value.split(LINE_BREAK_PATTERN, 1)[0] ?? value
}

function readFileReadSummary(output: ToolPayload): string | null {
  const type = output.type
  const file = output.file
  if (type === 'text' && file) {
    const lines = file.numLines
    const total = file.totalLines
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
    const count = file.count
    return count === null ? 'Extracted pages' : `${count} pages`
  }
  if (type === 'file_unchanged') {
    return 'File unchanged'
  }
  return null
}

function readDiffSummary(input: ToolPayload, output: ToolPayload): string | null {
  const additions = output.gitDiff.additions
  const deletions = output.gitDiff.deletions
  if (additions !== 0 || deletions !== 0) {
    return `+${additions} -${deletions}`
  }
  if (output.gitDiff.patch.length > 0) {
    return 'Patch prepared'
  }
  if (output.structuredPatch.length > 0) {
    return `${output.structuredPatch.length} hunk${output.structuredPatch.length === 1 ? '' : 's'}`
  }
  if (input.contentText !== null) {
    return 'Write content'
  }
  return null
}
function readTerminalSummary(output: ToolPayload): string | null {
  const backgroundTaskId = output.backgroundTaskId
  if (backgroundTaskId) {
    return `Background task ${backgroundTaskId}`
  }
  if (output.interrupted === true) {
    return 'Interrupted'
  }
  const stdout = output.stdout
  const stderr = output.stderr
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

function readSearchSummary(output: ToolPayload): string | null {
  const files = output.numFiles
  const matches = output.numMatches
  if (files !== null && matches !== null) {
    return `${matches} matches in ${files} files`
  }
  if (files !== null) {
    return `${files} file${files === 1 ? '' : 's'}`
  }
  return null
}

function readWebSummary(output: ToolPayload): string | null {
  const code = output.code
  const bytes = output.bytes
  if (code !== null && bytes !== null) {
    return `${code} · ${formatBytes(bytes)}`
  }
  const seconds = output.durationSeconds
  if (seconds !== null) {
    return `${seconds.toFixed(1)}s`
  }
  return null
}

function readSubagentSummary(output: ToolPayload): string | null {
  const status = output.status
  if (status === 'async_launched') {
    return 'Running in background'
  }
  const totalToolUseCount = output.totalToolUseCount
  const totalTokens = output.totalTokens
  if (totalToolUseCount !== null && totalTokens !== null) {
    return `${totalToolUseCount} tools · ${totalTokens} tokens`
  }
  return status
}

function readTodoCount(input: ToolPayload, output: ToolPayload): number | null {
  return output.newTodos.length > 0
    ? output.newTodos.length
    : input.todos.length > 0
      ? input.todos.length
      : null
}

function readTodoSummary(input: ToolPayload, output: ToolPayload): string | null {
  const count = readTodoCount(input, output)
  if (count === null) {
    return null
  }
  return `${count} todo${count === 1 ? '' : 's'}`
}

function readQuestionCount(input: ToolPayload, output: ToolPayload): number | null {
  return output.questions.length > 0
    ? output.questions.length
    : input.questions.length > 0
      ? input.questions.length
      : null
}

function readMcpSummary(output: ToolPayload): string | null {
  if (output.contents.length > 0) {
    return `${output.contents.length} content block${output.contents.length === 1 ? '' : 's'}`
  }
  return output.rawText ? 'Tool result' : null
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
