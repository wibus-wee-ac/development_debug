import { describe, expect, it } from 'vitest'

import type { RenderableToolPart, ToolUiKind } from './tool-ui-classifier'
import { describeToolCall, materializeStreamingToolInput } from './tool-ui-classifier'

function tool(toolName: string, input?: unknown, output?: unknown): RenderableToolPart {
  return {
    type: 'dynamic-tool',
    toolName,
    toolCallId: `call-${toolName}`,
    state: output === undefined ? 'input-available' : 'output-available',
    input,
    output,
  }
}

describe('describeToolCall', () => {
  it.each([
    ['Read', { file_path: '/repo/src/app.tsx' }, { type: 'text', file: { filePath: '/repo/src/app.tsx', content: 'code', numLines: 1, startLine: 1, totalLines: 1 } }, 'file-read'],
    ['Edit', { file_path: '/repo/src/app.tsx', old_string: 'old', new_string: 'new' }, { filePath: '/repo/src/app.tsx', structuredPatch: [] }, 'file-diff'],
    ['Edit File', { file_path: '/repo/src/app.tsx', old_string: 'old', new_string: 'new' }, 'updated', 'file-diff'],
    ['Write', { file_path: '/repo/src/new.ts', content: 'code' }, { type: 'create', filePath: '/repo/src/new.ts' }, 'file-diff'],
    ['Write File', { file_path: '/repo/src/new.ts', content: 'code' }, { type: 'create', filePath: '/repo/src/new.ts' }, 'file-diff'],
    ['NotebookEdit', { notebook_path: '/repo/notebook.ipynb', new_source: 'print(1)' }, { notebook_path: '/repo/notebook.ipynb' }, 'notebook-diff'],
    ['Bash', { command: 'pnpm test', description: 'Run tests' }, { stdout: 'pass', stderr: '', interrupted: false }, 'terminal'],
    ['Grep', { pattern: 'useChat', path: 'apps/web' }, { mode: 'files_with_matches', numFiles: 2, filenames: ['a.ts', 'b.ts'] }, 'search'],
    ['Glob', { pattern: '**/*.tsx' }, { durationMs: 1, numFiles: 2, filenames: ['a.tsx', 'b.tsx'], truncated: false }, 'search'],
    ['WebFetch', { url: 'https://example.com', prompt: 'summarize' }, { code: 200, codeText: 'OK', bytes: 1024, result: 'summary' }, 'web'],
    ['WebSearch', { query: 'AI SDK UIMessage' }, { query: 'AI SDK UIMessage', results: [], durationSeconds: 1.2 }, 'web'],
    ['Agent', { description: 'Investigate runtime', prompt: 'Find issue' }, { status: 'completed', agentId: 'a1', totalToolUseCount: 3, totalDurationMs: 2000, totalTokens: 100 }, 'subagent'],
    ['TaskOutput', { task_id: 'task-1', block: true, timeout: 1000 }, { message: 'done', task_id: 'task-1' }, 'task-control'],
    ['TaskStop', { task_id: 'task-1' }, { message: 'stopped', task_id: 'task-1', task_type: 'bash' }, 'task-control'],
    ['SendMessage', { task_id: 'agent-1', message: 'continue' }, { message: 'sent', task_id: 'agent-1' }, 'task-control'],
    ['TodoWrite', { todos: [{ content: 'Ship', status: 'pending', activeForm: 'Shipping' }] }, { oldTodos: [], newTodos: [{ content: 'Ship', status: 'completed', activeForm: 'Shipping' }] }, 'todo'],
    ['ExitPlanMode', { allowedPrompts: [{ tool: 'Bash', prompt: 'run tests' }] }, { plan: 'Plan', isAgent: false }, 'plan'],
    ['AskUserQuestion', { questions: [{ question: 'Pick?', header: 'Pick', options: [{ label: 'A', description: 'A' }, { label: 'B', description: 'B' }], multiSelect: false }] }, { questions: [], answers: { 'Pick?': 'A' } }, 'question'],
    ['ReadMcpResource', { server: 'docs', uri: 'file://guide' }, { contents: [{ uri: 'file://guide', text: 'doc' }] }, 'mcp'],
    ['ListMcpResources', { server: 'docs' }, [{ uri: 'file://guide' }], 'mcp'],
    ['mcp__browser__open', { url: 'https://example.com' }, 'ok', 'mcp'],
    ['EnterWorktree', { name: 'feature' }, { worktreePath: '/repo-feature', message: 'entered' }, 'worktree'],
    ['ExitWorktree', { action: 'keep' }, { worktreePath: '/repo-main', worktreeBranch: 'main', action: 'keep' }, 'worktree'],
  ] satisfies Array<[string, unknown, unknown, ToolUiKind]>)('classifies %s as %s', (toolName, input, output, expected) => {
    expect(describeToolCall(tool(toolName, input, output)).kind).toBe(expected)
  })

  it('keeps unknown tools renderable through the generic fallback', () => {
    const descriptor = describeToolCall(tool('custom_tool', { value: 1 }, { ok: true }))

    expect(descriptor).toMatchObject({
      kind: 'generic',
      displayName: 'Custom Tool',
      title: 'Custom Tool',
    })
  })

  it('classifies partial streaming edit input before the tool JSON is complete', () => {
    const partialInput = {
      input: '{"file_path":"/repo/src/app.tsx","old_string":"const value = 1","new_string":"const value = 2',
    }
    const descriptor = describeToolCall({
      type: 'dynamic-tool',
      toolName: 'Edit File',
      toolCallId: 'call-edit-streaming',
      state: 'input-streaming',
      input: partialInput,
    })

    expect(descriptor).toMatchObject({
      kind: 'file-diff',
      target: '/repo/src/app.tsx',
      title: 'Edit file',
    })
    expect(materializeStreamingToolInput(partialInput)).toMatchObject({
      file_path: '/repo/src/app.tsx',
      old_string: 'const value = 1',
      new_string: 'const value = 2',
    })
  })
})
