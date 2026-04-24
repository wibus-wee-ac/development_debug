// Input: useStatuses, useCreateStatus, useUpdateStatus, useDeleteStatus, useReorderStatuses hooks, DnD sortable, Popover, Input, Button
// Output: StatusManager component — workspace-level status management UI (shared across all boards)
// Position: Manages status columns for a workspace; opened from the board view toolbar

import type { DragEndEvent } from '@dnd-kit/core'
import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { KanbanStatus } from '@main/ipc-types'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Popover, PopoverPopup, PopoverTrigger } from '@renderer/components/ui/popover'
import { cn } from '@renderer/lib/cn'
import { GripVerticalIcon, PencilIcon, PlusIcon, TrashIcon, XIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useCreateStatus, useDeleteStatus, useReorderStatuses, useStatuses, useUpdateStatus } from './use-kanban'

const PRESET_COLORS = [
  '#94a3b8', // gray
  '#60a5fa', // blue
  '#34d399', // green
  '#fbbf24', // yellow
  '#f97316', // orange
  '#ef4444', // red
  '#a78bfa', // purple
  '#f472b6', // pink
]

interface StatusRowProps {
  status: KanbanStatus
  workspaceId: string
}

function StatusRow({ status, workspaceId }: StatusRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: status.id })
  const updateStatus = useUpdateStatus()
  const deleteStatus = useDeleteStatus()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(status.name)
  const [showColors, setShowColors] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
    }
  }, [editing])

  function handleNameSave() {
    const trimmed = name.trim()
    if (trimmed && trimmed !== status.name) {
      updateStatus.mutate({ id: status.id, workspaceId, patch: { name: trimmed } })
    }
    else {
      setName(status.name)
    }
    setEditing(false)
  }

  function handleColorPick(color: string) {
    updateStatus.mutate({ id: status.id, workspaceId, patch: { color } })
    setShowColors(false)
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50 group"
    >
      <button className="cursor-grab text-muted-foreground" {...attributes} {...listeners}>
        <GripVerticalIcon className="size-3.5" />
      </button>

      {/* Color dot */}
      <div className="relative">
        <button
          className="size-3.5 rounded-full shrink-0 ring-1 ring-border/50"
          style={{ backgroundColor: status.color ?? '#94a3b8' }}
          onClick={() => setShowColors(v => !v)}
          title="Change color"
        />
        {showColors && (
          <div className="absolute left-0 top-5 z-10 flex flex-wrap w-24 gap-1 rounded-lg border border-border bg-popover p-1.5 shadow-md">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                className={cn('size-4 rounded-full ring-1 ring-border/50 hover:ring-2 hover:ring-ring', status.color === c && 'ring-2 ring-ring')}
                style={{ backgroundColor: c }}
                onClick={() => handleColorPick(c)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Name */}
      {editing
        ? (
          <Input
            ref={inputRef}
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={handleNameSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleNameSave()
              }
              if (e.key === 'Escape') {
                setName(status.name)
                setEditing(false)
              }
            }}
            className="h-6 flex-1 text-xs"
          />
        )
        : (
          <span className="flex-1 text-sm truncate">
            {status.name}
          </span>
        )}

      {/* Actions */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          onClick={() => setEditing(v => !v)}
          title="Rename"
        >
          <PencilIcon className="size-3" />
        </button>
        <button
          className="rounded p-0.5 text-muted-foreground hover:text-destructive"
          onClick={() => deleteStatus.mutate({ id: status.id, workspaceId })}
          title="Delete status"
        >
          <TrashIcon className="size-3" />
        </button>
      </div>
    </div>
  )
}

interface StatusManagerProps {
  workspaceId: string
}

export function StatusManager({ workspaceId }: StatusManagerProps) {
  const { data: statuses = [] } = useStatuses(workspaceId)
  const createStatus = useCreateStatus()
  const reorderStatuses = useReorderStatuses()
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')

  const sensors = useSensors(useSensor(PointerSensor))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) {
      return
    }
    const oldIndex = statuses.findIndex(s => s.id === active.id)
    const newIndex = statuses.findIndex(s => s.id === over.id)
    const reordered = arrayMove(statuses, oldIndex, newIndex)
    reorderStatuses.mutate({ workspaceId, orderedIds: reordered.map(s => s.id) })
  }

  async function handleAdd() {
    const name = newName.trim()
    if (!name) {
      return
    }
    await createStatus.mutateAsync({ workspaceId, name })
    setNewName('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<span />}>
        <Button variant="outline" size="sm">
          Manage statuses
        </Button>
      </PopoverTrigger>
      <PopoverPopup className="w-72 p-3" align="end">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Statuses</p>
            <p className="text-xs text-muted-foreground">
              Shared across all boards in this workspace.
            </p>
          </div>
          <button className="text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)}>
            <XIcon className="size-4" />
          </button>
        </div>

        <DndContext sensors={sensors} modifiers={[restrictToVerticalAxis]} onDragEnd={handleDragEnd}>
          <SortableContext items={statuses.map(s => s.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-0.5">
              {statuses.map(s => (
                <StatusRow key={s.id} status={s} workspaceId={workspaceId} />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        <div className="mt-2 flex gap-1.5">
          <Input
            placeholder="Add status…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void handleAdd()
              }
            }}
            className="h-7 text-sm flex-1"
          />
          <Button size="sm" onClick={() => void handleAdd()} disabled={!newName.trim() || createStatus.isPending}>
            <PlusIcon className="size-3.5" />
          </Button>
        </div>
      </PopoverPopup>
    </Popover>
  )
}
