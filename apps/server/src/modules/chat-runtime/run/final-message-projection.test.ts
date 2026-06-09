import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import type { FinalMessageProjectionRun } from './final-message-projection'
import {
  createFinalMessageProjectionState,
  projectFinalMessageChunk,
} from './final-message-projection'

function createProjectionRun(): FinalMessageProjectionRun {
  return {
    finalMessage: {
      id: 'assistant-1',
      role: 'assistant',
      parts: [],
    } satisfies UIMessage,
    finalProjection: createFinalMessageProjectionState(),
  }
}

function readToolPart(message: UIMessage, toolCallId: string): UIMessage['parts'][number] {
  const part = message.parts.find(candidate =>
    'toolCallId' in candidate && candidate.toolCallId === toolCallId)
  if (!part) {
    throw new Error(`Missing projected tool part ${toolCallId}`)
  }
  return part
}

describe('projectFinalMessageChunk', () => {
  it('clears preliminary tool output state when the terminal output arrives', () => {
    const run = createProjectionRun()

    projectFinalMessageChunk(run, {
      type: 'tool-input-start',
      toolCallId: 'toolu_subagent',
      toolName: 'task',
    })
    projectFinalMessageChunk(run, {
      type: 'tool-input-available',
      toolCallId: 'toolu_subagent',
      toolName: 'task',
      input: { description: 'Inspect lifecycle' },
    })
    projectFinalMessageChunk(run, {
      type: 'tool-output-available',
      toolCallId: 'toolu_subagent',
      preliminary: true,
      output: { message: 'still running' },
    })

    expect(readToolPart(run.finalMessage, 'toolu_subagent')).toEqual(
      expect.objectContaining({ preliminary: true }),
    )

    projectFinalMessageChunk(run, {
      type: 'tool-output-available',
      toolCallId: 'toolu_subagent',
      output: { message: 'finished' },
    })

    expect(readToolPart(run.finalMessage, 'toolu_subagent')).toEqual(
      expect.not.objectContaining({ preliminary: true }),
    )
  })
})
