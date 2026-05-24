// Shared compact queue controls for Chat Session continuation items.
import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon, XIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

import type { ChatQueueItem } from './chat-response-command'

interface ChatQueueListProps {
  items: ChatQueueItem[]
  onCancel: (queueItemId: string) => void
  onReorder: (queueItemIds: string[]) => void
  className?: string
  title?: string
}

export function ChatQueueList({
  items,
  onCancel,
  onReorder,
  className,
  title = 'Queue',
}: ChatQueueListProps) {
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null)
  const pendingItems = items?.filter(item => item.status === 'pending') ?? []
  if (pendingItems.length === 0) {
    return null
  }

  const reorderByDrop = (targetItemId: string) => {
    if (!draggedItemId || draggedItemId === targetItemId) {
      return
    }
    const fromIndex = pendingItems.findIndex(item => item.id === draggedItemId)
    const toIndex = pendingItems.findIndex(item => item.id === targetItemId)
    if (fromIndex < 0 || toIndex < 0) {
      return
    }
    const nextItems = [...pendingItems]
    const movedItem = nextItems[fromIndex]
    if (!movedItem) {
      return
    }
    nextItems.splice(fromIndex, 1)
    nextItems.splice(toIndex, 0, movedItem)
    onReorder(nextItems.map(item => item.id))
  }

  const moveItem = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= pendingItems.length) {
      return
    }
    const nextItems = [...pendingItems]
    const currentItem = nextItems[index]
    nextItems[index] = nextItems[nextIndex]
    nextItems[nextIndex] = currentItem
    onReorder(nextItems.map(item => item.id))
  }

  return (
    <div
      className={cn('rounded-md border border-border/50 bg-background/90 px-2 py-2', className)}
      data-testid="chat-queue-list"
      role="list"
      aria-live="polite"
    >
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className="text-[11px] font-medium text-muted-foreground">{title}</span>
        <span className="text-[10px] tabular-nums text-muted-foreground">{pendingItems.length}</span>
      </div>
      <div className="space-y-1">
        {pendingItems.map((item, index) => {
          const itemLabel = item.text || `${item.files.length} attachment${item.files.length === 1 ? '' : 's'}`
          return (
            <div
              key={item.id}
              className={cn(
                'flex items-center gap-2 rounded-md bg-muted/35 px-2 py-1.5 text-xs transition-colors',
                draggedItemId === item.id && 'bg-muted/70 opacity-70',
              )}
              data-testid="chat-queue-item"
              role="listitem"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', item.id)
                setDraggedItemId(item.id)
              }}
              onDragOver={(event) => {
                if (draggedItemId && draggedItemId !== item.id) {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                }
              }}
              onDrop={(event) => {
                event.preventDefault()
                reorderByDrop(item.id)
                setDraggedItemId(null)
              }}
              onDragEnd={() => setDraggedItemId(null)}
            >
              <span className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/60 active:cursor-grabbing">
                <GripVerticalIcon className="size-3.5" aria-hidden="true" />
              </span>
              <span
                className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                  item.mode === 'steer' ? 'bg-primary/10 text-primary' : 'bg-secondary text-secondary-foreground',
                )}
              >
                {item.mode === 'steer' ? 'Steer' : 'Queue'}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground/85">
                {itemLabel}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={index === 0}
                onClick={() => moveItem(index, -1)}
                aria-label={`Move queue item up: ${itemLabel}`}
              >
                <ArrowUpIcon className="size-3" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={index === pendingItems.length - 1}
                onClick={() => moveItem(index, 1)}
                aria-label={`Move queue item down: ${itemLabel}`}
              >
                <ArrowDownIcon className="size-3" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => onCancel(item.id)}
                aria-label={`Cancel queue item: ${itemLabel}`}
              >
                <XIcon className="size-3" aria-hidden="true" />
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
