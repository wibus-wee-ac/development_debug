/**
 * Output: Regression coverage for shared chat TODO projection.
 * Input: Claude-style TODO payload statuses and labels.
 * Position: Feature-owned tests for session-level TODO state mapping.
 */

import { describe, expect, it } from 'vitest'

import { projectChatTodos, selectTodosFromMessages } from './chat-todo-projection'
import { readToolPayload } from './tool-ui-classifier'

describe('projectChatTodos', () => {
  it('maps Claude TODO statuses and processing labels into shared TODO items', () => {
    const input = readToolPayload({})
    const output = readToolPayload({
      todos: [
        { id: 'todo-1', content: 'Inspect', status: 'pending' },
        { id: 'todo-2', content: 'Patch', activeForm: 'Patching', status: 'in_progress' },
        { id: 'todo-3', content: 'Verify', status: 'completed' },
      ],
    })

    expect(projectChatTodos(input, output)).toEqual([
      { id: 'todo-1', content: 'Inspect', status: 'todo', sourceStatus: 'pending' },
      { id: 'todo-2', content: 'Patching', status: 'processing', sourceStatus: 'in_progress' },
      { id: 'todo-3', content: 'Verify', status: 'completed', sourceStatus: 'completed' },
    ])
  })

  it('selects the latest persisted TodoWrite plugin state from messages', () => {
    expect(selectTodosFromMessages([
      {
        id: 'message-1',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolCallId: 'toolu_old',
            toolName: 'TodoWrite',
            state: 'output-available',
            input: {},
            output: {
              pluginState: {
                todos: [
                  { id: 'todo-old', content: 'Old task', status: 'completed', sourceStatus: 'completed' },
                ],
              },
            },
          },
        ],
      },
      {
        id: 'message-2',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolCallId: 'toolu_new',
            toolName: 'TodoWrite',
            state: 'output-available',
            input: {},
            output: {
              pluginState: {
                todos: [
                  { id: 'todo-new', content: 'Current task', status: 'processing', sourceStatus: 'in_progress' },
                ],
              },
            },
          },
        ],
      },
    ])).toEqual({
      messageId: 'message-2',
      toolCallId: 'toolu_new',
      todos: [
        { id: 'todo-new', content: 'Current task', status: 'processing', sourceStatus: 'in_progress' },
      ],
    })
  })

  it('falls back to persisted tool args when plugin state is missing', () => {
    expect(selectTodosFromMessages([
      {
        id: 'message-1',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolCallId: 'toolu_args',
            toolName: 'TodoWrite',
            state: 'output-available',
            input: {
              todos: [
                { id: 'todo-1', content: 'Explore', status: 'completed' },
                { id: 'todo-2', content: 'Build', activeForm: 'Building', status: 'in_progress' },
              ],
            },
            output: { ok: true },
          },
        ],
      },
    ])).toEqual({
      messageId: 'message-1',
      toolCallId: 'toolu_args',
      todos: [
        { id: 'todo-1', content: 'Explore', status: 'completed', sourceStatus: 'completed' },
        { id: 'todo-2', content: 'Building', status: 'processing', sourceStatus: 'in_progress' },
      ],
    })
  })
})
