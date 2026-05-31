// Output: Claude Code tool identity constants for the Claude Agent runtime provider.
// Input: Claude Agent SDK tool_use names.
// Position: Claude Agent provider-owned tool namespace used by its protocol mapper.

export const ClaudeCodeToolIdentifier = 'claude-code'

export enum ClaudeCodeToolName {
  Agent = 'Agent',
  AskUserQuestion = 'askUserQuestion',
  Bash = 'Bash',
  Edit = 'Edit',
  Glob = 'Glob',
  Grep = 'Grep',
  Monitor = 'Monitor',
  Read = 'Read',
  ScheduleWakeup = 'ScheduleWakeup',
  Skill = 'Skill',
  TaskCreate = 'TaskCreate',
  TaskGet = 'TaskGet',
  TaskList = 'TaskList',
  TaskOutput = 'TaskOutput',
  TaskStop = 'TaskStop',
  TaskUpdate = 'TaskUpdate',
  TodoWrite = 'TodoWrite',
  ToolSearch = 'ToolSearch',
  WebFetch = 'WebFetch',
  WebSearch = 'WebSearch',
  Write = 'Write',
}
