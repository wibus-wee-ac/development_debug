/**
 * Output: Regression coverage for chat tool UI classification.
 * Input: AI SDK and runtime tool call payload shapes.
 * Position: Feature-owned tests for the chat render classifier.
 */

import { describe, expect, it } from 'vitest'

import type { RenderableToolPart } from './tool-ui-classifier'
import { describeToolCall } from './tool-ui-classifier'

describe('describeToolCall', () => {
  it('describes object payloads without optional file or content fields', () => {
    const part: RenderableToolPart = {
      type: 'dynamic-tool',
      toolCallId: 'call-1',
      toolName: 'unknown_tool',
      state: 'output-available',
      input: {
        message: 'Run a custom action',
      },
      output: {
        status: 'done',
      },
    }

    expect(() => describeToolCall(part)).not.toThrow()
    expect(describeToolCall(part)).toMatchObject({
      kind: 'generic',
      toolName: 'unknown_tool',
      displayName: 'Unknown Tool',
    })
  })

  it('keeps classifying command payloads when optional fields are absent', () => {
    const part: RenderableToolPart = {
      type: 'dynamic-tool',
      toolCallId: 'call-2',
      toolName: 'bash',
      state: 'output-available',
      input: {
        command: 'pnpm test',
      },
      output: {
        stdout: 'passed',
      },
    }

    expect(describeToolCall(part)).toMatchObject({
      kind: 'terminal',
      title: 'Run command',
      target: 'pnpm test',
      summary: 'stdout available',
    })
  })

  it('describes file edits while tool arguments are still streaming', () => {
    const part: RenderableToolPart = {
      type: 'dynamic-tool',
      toolCallId: 'call-edit',
      toolName: 'Edit',
      state: 'input-streaming',
      argumentsText: '{"file_path":"/tmp/story.html","old_string":"<main>draft',
    }

    expect(describeToolCall(part)).toMatchObject({
      kind: 'file-diff',
      title: 'Edit file',
      target: '/tmp/story.html',
    })
  })

  it('classifies Claude Agent task tools as todo updates', () => {
    const part: RenderableToolPart = {
      type: 'dynamic-tool',
      toolCallId: 'task-create-1',
      toolName: 'TaskCreate',
      state: 'output-available',
      input: {
        task: 'Inspect the chat runtime mapper',
        status: 'pending',
      },
      output: {
        tasks: [
          { id: 'task-1', title: 'Inspect the chat runtime mapper', status: 'completed' },
          { id: 'task-2', title: 'Wire task tool UI', status: 'in_progress' },
        ],
      },
    }

    expect(describeToolCall(part)).toMatchObject({
      kind: 'todo',
      title: 'Update todos',
      target: '2 items',
      summary: '1/2 done',
    })
  })

  it('describes Codex app-server plan items from structured output', () => {
    const part: RenderableToolPart = {
      type: 'dynamic-tool',
      toolCallId: 'plan-1',
      toolName: 'plan',
      state: 'output-available',
      input: {
        text: '1. Inspect the mapper\n2. Patch the UI',
      },
      output: {
        plan: '1. Inspect the mapper\n2. Patch the UI',
      },
    }

    expect(describeToolCall(part)).toMatchObject({
      kind: 'plan',
      title: 'Submit plan',
      summary: 'Plan ready',
    })
  })

  it('describes Codex app-server file changes from structured filenames', () => {
    const part: RenderableToolPart = {
      type: 'dynamic-tool',
      toolCallId: 'file-1',
      toolName: 'file_change',
      state: 'output-available',
      input: {
        filenames: ['src/app.ts'],
      },
      output: {
        filenames: ['src/app.ts'],
        status: 'completed',
      },
    }

    expect(describeToolCall(part)).toMatchObject({
      kind: 'file-diff',
      title: 'Edit file',
      target: 'src/app.ts',
    })
  })
})
