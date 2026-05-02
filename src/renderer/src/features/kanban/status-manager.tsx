// Input: useStatuses, useCreateStatus, useUpdateStatus, useDeleteStatus, useReorderStatuses hooks, DnD sortable
// Output: StatusManager component — workspace-level status management UI
// Position: Manages status columns for a workspace; opened from the board view toolbar

import type { DragEndEvent } from '@dnd-kit/core'
import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { KanbanStatus } from '@main/ipc-types'
import { cn } from '@renderer/lib/cn'
import { GripVerticalIcon, PlusIcon, TrashIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useCreateStatus, useDeleteStatus, useReorderStatuses, useStatuses, useUpdateStatus } from './use-kanban'

const PRESET_COLORS = [
  '#64748b', '#60a5fa', '#34d399', '#fbbf24',
  '#f97316', '#ef4444', '#a78bfa', '#f472b6',
]

function StatusRow({ status, workspaceId }: { status: KanbanStatus, workspaceId: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: status.id })
  const updateStatus = useUpdateStatus()
  const deleteStatus = useDeleteStatus()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(status.name)
  const [showColors, setShowColors] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  function handleNameSave() {
    const trimmed = name.trim()
    if (trimmed && trimmed !== status.name) {
      updateStatus.mutate({ id: status.id, workspaceId, patch: { name: trimmed } })
    }
    else { setName(status.name) }
    setEditing(false)
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/30 group"
    >
      <button className="cursor-grab text-muted-foreground/30" {...attributes} {...listeners}>
        <GripVerticalIcon className="size-3" />
      </button>

      <div className="relative">
        <button
          className="size-3 rounded-full shrink-0"
          style={{ backgroundColor: status.color ?? '#64748b' }}
          onClick={() => setShowColors(v => !v)}
        />
        {showColors && (
          <div className="absolute left-0 top-5 z-10 flex flex-wrap w-20 gap-1 rounded-md border border-border/50 bg-popover p-1.5">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                className={cn('size-3.5 rounded-full hover:ring-1 hover:ring-ring', status.color === c && 'ring-1 ring-ring')}
                style={{ backgroundColor: c }}
                onClick={() => {
                  updateStatus.mutate({ id: status.id, workspaceId, patch: { color: c } })
                  setShowColors(false)
                }}
              />
            ))}
          </div>
        )}
      </div>

      {editing
        ? (
          <input
            ref={inputRef}
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={handleNameSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleNameSave()
              if (e.key === 'Escape') { setName(status.name); setEditing(false) }
            }}
            className="flex-1 text-[13px] bg-transparent outline-none"
          />
        )
        : (
          <span
            className="flex-1 text-[13px] truncate cursor-text"
            onClick={() => setEditing(true)}
          >
            {status.name}
          </span>
        )}

      <button
        className="text-muted-foreground/20 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
        onClick={() => deleteStatus.mutate({ id: status.id, workspaceId })}
      >
        <TrashIcon className="size-3" />
      </button>
    </div>
  )
}

export function StatusManager({ workspaceId }: { workspaceId: string }) {
  const { data: statuses = [] } = useStatuses(workspaceId)
  const createStatus = useCreateStatus()
  const reorderStatuses = useReorderStatuses()
  const [newName, setNewName] = useState('')

  const sensors = useSensors(useSensor(PointerSensor))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = statuses.findIndex(s => s.id === active.id)
    const newIndex = statuses.findIndex(s => s.id === over.id)
    const reordered = arrayMove(statuses, oldIndex, newIndex)
    reorderStatuses.mutate({ workspaceId, orderedIds: reordered.map(s => s.id) })
  }

  async function handleAdd() {
    const name = newName.trim()
    if (!name) return
    await createStatus.mutateAsync({ workspaceId, name })
    setNewName('')
  }

  return (
    <div>
      <p className="text-[12px] text-muted-foreground mb-2">Statuses</p>

      <DndContext sensors={sensors} modifiers={[restrictToVerticalAxis]} onDragEnd={handleDragEnd}>
        <SortableContext items={statuses.map(s => s.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-px">
            {statuses.map(s => (
              <StatusRow key={s.id} status={s} workspaceId={workspaceId} />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="mt-2 flex gap-1.5 items-center">
        <input
          placeholder="Add status…"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd() }}
          className="flex-1 text-[13px] bg-transparent outline-none placeholder:text-muted-foreground/30"
          data-testid="status-name-input"
        />
        <button
          className="text-muted-foreground/30 hover:text-foreground transition-colors disabled:opacity-30"
          onClick={() => void handleAdd()}
          disabled={!newName.trim() || createStatus.isPending}
          data-testid="status-add-btn"
        >
          <PlusIcon className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
