/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ChatQueueList } from './chat-queue-list'
import type { ChatQueueItem } from './chat-response-command'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'continuation.mode.queue': 'Queue',
        'continuation.mode.steer': 'Steer',
        'continuation.queue.cancel': 'Cancel queue item: {{label}}',
        'continuation.queue.emptyLabel': 'Empty continuation',
        'continuation.queue.moveDown': 'Move queue item down: {{label}}',
        'continuation.queue.moveUp': 'Move queue item up: {{label}}',
        'continuation.queue.title': 'Queue',
        'continuation.status.running': 'Running',
      }
      return (translations[key] ?? key).replaceAll('{{label}}', String(values?.label ?? ''))
    },
  }),
}))

const queueItems: ChatQueueItem[] = [
  {
    id: 'queue-1',
    sessionId: 'session-1',
    mode: 'queue',
    status: 'pending',
    text: 'First',
    files: [],
    contextParts: [],
    providerTargetId: null,
    modelId: null,
    thinkingEffort: null,
    permissionMode: null,
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
    contextParts: [],
    providerTargetId: null,
    modelId: null,
    thinkingEffort: null,
    permissionMode: null,
    position: 2,
    sourceRunId: null,
    startedRunId: null,
    errorText: null,
    createdAt: 2,
    updatedAt: 2,
  },
]

const queueItemsWithRunning: ChatQueueItem[] = [
  queueItems[0],
  {
    id: 'queue-running',
    sessionId: 'session-1',
    mode: 'steer',
    status: 'running',
    text: 'Live steer',
    files: [],
    contextParts: [],
    providerTargetId: null,
    modelId: null,
    thinkingEffort: null,
    permissionMode: null,
    position: 2,
    sourceRunId: 'run-1',
    startedRunId: 'run-1',
    errorText: null,
    createdAt: 2,
    updatedAt: 2,
  },
  {
    ...queueItems[1],
    position: 3,
  },
]

afterEach(() => {
  cleanup()
})

describe('chatQueueList', () => {
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

  it('shows running steer items without treating them as pending reorder or cancel targets', () => {
    const onCancel = vi.fn()
    const onReorder = vi.fn()
    render(<ChatQueueList items={queueItemsWithRunning} onCancel={onCancel} onReorder={onReorder} />)

    expect(screen.getByText('Live steer')).toBeTruthy()
    expect(screen.getByText('Running')).toBeTruthy()
    expect(screen.queryByLabelText('Cancel queue item: Live steer')).toBeNull()

    fireEvent.click(screen.getByLabelText('Move queue item up: Second'))

    expect(onReorder).toHaveBeenCalledWith(['queue-2', 'queue-1'])
    expect(onCancel).not.toHaveBeenCalled()
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
