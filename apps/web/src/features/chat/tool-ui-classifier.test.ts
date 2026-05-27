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
})
