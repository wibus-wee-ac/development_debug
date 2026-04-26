// Input: boardId, workspaceId, useStatuses, useIssues, useMoveIssue, dnd-kit
// Output: KanbanBoardView — horizontally-scrollable column board with DnD (Linear-style)
// Position: Main board view, mounted by kanban.$boardId.lazy.tsx

import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import {
  closestCorners,
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { KanbanIssue } from '@main/ipc-types'
import { Spinner } from '@renderer/components/ui/spinner'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'

import { CreateIssueDialog } from './create-issue-dialog'
import { IssueCard } from './issue-card'
import { KanbanColumn } from './kanban-column'
import { useIssues, useMoveIssue, useStatuses } from './use-kanban'

interface KanbanBoardViewProps {
  boardId: string
  workspaceId: string
}

export function KanbanBoardView({ boardId, workspaceId }: KanbanBoardViewProps) {
  const { data: statuses = [], isLoading: loadingStatuses } = useStatuses(workspaceId)
  const { data: allIssues = [], isLoading: loadingIssues } = useIssues({ workspaceId })
  const moveIssue = useMoveIssue()
  const navigate = useNavigate()

  const [activeIssue, setActiveIssue] = useState<KanbanIssue | null>(null)
  const [createStatusId, setCreateStatusId] = useState<string | null>(null)

  // Group issues by status
  const issuesByStatus = useMemo(() => {
    const map = new Map<string, KanbanIssue[]>()
    for (const s of statuses) {
      map.set(s.id, [])
    }
    // Also create an "unassigned" bucket for issues with no status
    map.set('__none__', [])
    for (const issue of allIssues) {
      if (!issue.parentIssueId) {
        const bucket = issue.statusId ? (map.get(issue.statusId) ?? map.get('__none__')!) : map.get('__none__')!
        bucket.push(issue)
      }
    }
    return map
  }, [statuses, allIssues])

  // DnD sensors
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event
    const issue = active.data.current?.issue as KanbanIssue | undefined
    if (issue) {
      setActiveIssue(issue)
    }
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveIssue(null)
    const { active, over } = event
    if (!over) {
      return
    }

    const issueId = active.id as string

    // Determine target status
    let targetStatusId: string | null = null
    if (over.data.current?.type === 'column') {
      targetStatusId = over.data.current.statusId as string
    }
    else if (over.data.current?.type === 'issue') {
      const targetIssue = over.data.current.issue as KanbanIssue
      targetStatusId = targetIssue.statusId
    }

    if (targetStatusId && targetStatusId !== '__none__') {
      const currentIssue = allIssues.find(i => i.id === issueId)
      if (currentIssue && currentIssue.statusId !== targetStatusId) {
        moveIssue.mutate({ id: issueId, statusId: targetStatusId })
      }
    }
  }, [allIssues, moveIssue])

  const handleIssueClick = useCallback((issue: KanbanIssue) => {
    navigate({ to: '/kanban/$boardId/$issueId', params: { boardId, issueId: issue.id } })
  }, [navigate, boardId])

  if (loadingStatuses || loadingIssues) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <CreateIssueDialog
        open={createStatusId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreateStatusId(null)
          }
        }}
        workspaceId={workspaceId}
        defaultStatusId={createStatusId}
      />
      {/* Board columns */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex flex-1 gap-1 overflow-x-auto overflow-y-hidden p-2">
          {statuses.map(status => (
            <KanbanColumn
              key={status.id}
              status={status}
              issues={issuesByStatus.get(status.id) ?? []}
              onIssueClick={handleIssueClick}
              onOpenCreate={setCreateStatusId}
            />
          ))}

          {/* Unassigned column */}
          {(issuesByStatus.get('__none__')?.length ?? 0) > 0 && (
            <KanbanColumn
              status={{ id: '__none__', workspaceId, name: '无状态', color: null, order: 999, createdAt: 0 }}
              issues={issuesByStatus.get('__none__') ?? []}
              onIssueClick={handleIssueClick}
              onOpenCreate={setCreateStatusId}
            />
          )}
        </div>

        {/* Drag overlay */}
        <DragOverlay dropAnimation={null}>
          {activeIssue && (
            <div className="w-68 rounded-md bg-card ring-1 ring-border/30 inset-shadow-[0_1px_--theme(--color-white/10%)]">
              <IssueCard issue={activeIssue} onClick={() => { }} isDragging />
            </div>
          )}
        </DragOverlay>
      </DndContext>

    </div>
  )
}
