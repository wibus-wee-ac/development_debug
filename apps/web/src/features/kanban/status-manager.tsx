// Input: Board ID, statuses list
// Output: Status configuration panel with add/edit/delete/reorder
// Position: Toggled panel inside kanban board view

import type { DragEndEvent } from '@dnd-kit/core'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVerticalIcon, TrashIcon } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'

import { StatusIcon } from './shared/status-icon'
import { useCreateStatus, useDeleteStatus, useReorderStatuses, useStatuses, useUpdateStatus } from './use-kanban'
import type { StatusCategory } from './use-view-config'

interface StatusManagerProps {
  boardId: string
}

export function StatusManager({ boardId }: StatusManagerProps) {
  const statuses = useStatuses(boardId)
  const createStatus = useCreateStatus()
  const updateStatus = useUpdateStatus()
  const deleteStatus = useDeleteStatus()
  const reorderStatuses = useReorderStatuses()
  const [newName, setNewName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
  )

  const handleAdd = useCallback(() => {
    const name = newName.trim()
    if (!name) return
    createStatus.mutate(
      { workspaceId: boardId, name },
      { onSuccess: () => setNewName('') },
    )
  }, [newName, boardId, createStatus])

  const handleDelete = useCallback((statusId: string) => {
    deleteStatus.mutate({ id: statusId, workspaceId: boardId })
  }, [boardId, deleteStatus])

  const handleRename = useCallback((statusId: string, name: string) => {
    updateStatus.mutate({ id: statusId, workspaceId: boardId, patch: { name } })
  }, [boardId, updateStatus])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const items = statuses.data ?? []
    const oldIdx = items.findIndex(s => s.id === active.id)
    const newIdx = items.findIndex(s => s.id === over.id)
    if (oldIdx === -1 || newIdx === -1) return
    const reordered = arrayMove(items, oldIdx, newIdx)
    reorderStatuses.mutate({ workspaceId: boardId, orderedIds: reordered.map(s => s.id) })
  }, [statuses.data, boardId, reorderStatuses])

  const statusIds = (statuses.data ?? []).map(s => s.id)

  return (
    <div data-testid="status-manager" className="w-72 rounded-lg border border-border bg-popover p-3 shadow-lg">
      <h4 className="mb-2 text-[12px] font-medium text-muted-foreground">状态管理</h4>

      {/* Add new status */}
      <div className="mb-3 flex items-center gap-1">
        <Input
          ref={inputRef}
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleAdd()
            }
          }}
          placeholder="添加状态..."
          data-testid="status-name-input"
          className="h-7 flex-1 text-[13px]"
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[12px]"
          onClick={handleAdd}
          disabled={!newName.trim()}
        >
          添加
        </Button>
      </div>

      {/* Status list */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={statusIds} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-0.5">
            {statuses.data?.map(status => (
              <SortableStatusRow
                key={status.id}
                id={status.id}
                name={status.name}
                category={(status.category ?? 'unstarted') as StatusCategory}
                onRename={(name) => handleRename(status.id, name)}
                onDelete={() => handleDelete(status.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}

function SortableStatusRow({
  id,
  name,
  category,
  onRename,
  onDelete,
}: {
  id: string
  name: string
  category: StatusCategory
  onRename: (name: string) => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(name)

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const handleConfirm = () => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== name) {
      onRename(trimmed)
    }
    setEditing(false)
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`status-row-${id}`}
      className="flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-muted/50"
    >
      <div
        data-testid={`status-drag-${id}`}
        className="cursor-grab text-muted-foreground/40 touch-none"
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon className="size-3" />
      </div>

      <StatusIcon category={category} size={12} />

      {editing ? (
        <input
          data-testid={`status-input-${id}`}
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleConfirm()
            else if (e.key === 'Escape') setEditing(false)
          }}
          onBlur={handleConfirm}
          autoFocus
          className="flex-1 bg-transparent text-[13px] outline-none"
        />
      ) : (
        <span
          data-testid={`status-name-${id}`}
          onClick={() => {
            setEditValue(name)
            setEditing(true)
          }}
          className="flex-1 cursor-text text-[13px] text-foreground"
        >
          {name}
        </span>
      )}

      <button
        data-testid={`status-delete-${id}`}
        onClick={onDelete}
        className="text-muted-foreground/40 hover:text-destructive transition-colors"
      >
        <TrashIcon className="size-3" />
      </button>
    </div>
  )
}
