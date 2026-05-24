/**
 * Output: Regression coverage for Chat Session queue list ordering controls.
 * Input: Pending queue items, drag/drop events, and button reorder clicks.
 * Position: Feature-owned tests for shared continuation queue controls.
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ChatQueueItem } from './chat-response-command'
import { ChatQueueList } from './chat-queue-list'

const queueItems: ChatQueueItem[] = [
  {
    id: 'queue-1',
    sessionId: 'session-1',
    mode: 'queue',
    status: 'pending',
    text: 'First',
    files: [],
    providerTargetId: null,
    modelId: null,
    thinkingEffort: null,
    position: 1,
    sourceRunId: null,
    startedRunId: null,
    errorText: null,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'queue-2',
    sessionId: 'session-1',
    mode: 'steer',
    status: 'pending',
    text: 'Second',
    files: [],
    providerTargetId: null,
    modelId: null,
    thinkingEffort: null,
    position: 2,
    sourceRunId: null,
    startedRunId: null,
    errorText: null,
    createdAt: 2,
    updatedAt: 2,
  },
]

afterEach(() => {
  cleanup()
})

describe('ChatQueueList', () => {
  it('reorders pending items with drag and drop', () => {
    const onReorder = vi.fn()
    render(<ChatQueueList items={queueItems} onCancel={vi.fn()} onReorder={onReorder} />)

    fireEvent.dragStart(screen.getByText('First').closest('[data-testid="chat-queue-item"]')!, {
      dataTransfer: createDataTransfer(),
    })
    fireEvent.dragOver(screen.getByText('Second').closest('[data-testid="chat-queue-item"]')!, {
      dataTransfer: createDataTransfer(),
    })
    fireEvent.drop(screen.getByText('Second').closest('[data-testid="chat-queue-item"]')!, {
      dataTransfer: createDataTransfer(),
    })

    expect(onReorder).toHaveBeenCalledWith(['queue-2', 'queue-1'])
  })

  it('keeps button reorder as an accessible fallback', () => {
    const onReorder = vi.fn()
    render(<ChatQueueList items={queueItems} onCancel={vi.fn()} onReorder={onReorder} />)

    fireEvent.click(screen.getByLabelText('Move queue item up: Second'))

    expect(onReorder).toHaveBeenCalledWith(['queue-2', 'queue-1'])
  })
})

function createDataTransfer(): DataTransfer {
  return {
    dropEffect: 'move',
    effectAllowed: 'move',
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [],
    clearData: vi.fn(),
    getData: vi.fn(),
    setData: vi.fn(),
    setDragImage: vi.fn(),
  }
}
