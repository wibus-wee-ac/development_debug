// Input: KanbanColumn, IssuePanel, StatusManager, useIssues, useStatuses, useMilestones, useBoards, DnD kit
// Output: KanbanBoardView component — full board layout with status columns, drag-and-drop, and issue panel
// Position: Main board view; rendered in the /kanban/$boardId route

import type { DragEndEvent } from '@dnd-kit/core'
import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { KanbanIssue } from '@main/ipc-types'
import { cn } from '@renderer/lib/cn'
import { LayoutDashboardIcon, SettingsIcon } from 'lucide-react'
import { useState } from 'react'

import { IssuePanel } from './issue-panel'
import { KanbanColumn } from './kanban-column'
import { StatusManager } from './status-manager'
import { useIssues, useMilestones, useMoveIssue, useStatuses } from './use-kanban'

interface KanbanBoardViewProps {
  boardId: string
  workspaceId: string
}

export function KanbanBoardView({ boardId: _boardId, workspaceId }: KanbanBoardViewProps) {
  const { data: statuses = [] } = useStatuses(workspaceId)
  const { data: milestones = [] } = useMilestones(workspaceId)
  const { data: issues = [] } = useIssues({ workspaceId })
  const moveIssue = useMoveIssue()

  const [selectedIssue, setSelectedIssue] = useState<KanbanIssue | null>(null)
  const [statusManagerOpen, setStatusManagerOpen] = useState(false)

  const milestoneMap = Object.fromEntries(milestones.map(m => [m.id, m]))

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over) {
      return
    }
    const issueId = active.id as string
    const targetStatusId = (over.data.current as { statusId: string | null } | undefined)?.statusId ?? null
    const issue = issues.find(i => i.id === issueId)
    if (!issue || issue.statusId === targetStatusId) {
      return
    }
    moveIssue.mutate({ id: issueId, statusId: targetStatusId })
  }

  const unassignedIssues = issues.filter(i => !i.statusId)

  const statusColumns = statuses.map(s => ({
    status: s,
    issues: issues.filter(i => i.statusId === s.id),
  }))

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b px-4 py-2 shrink-0">
        <LayoutDashboardIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Board</span>
        <div className="ml-auto">
          <button
            className={cn(
              'flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-md',
              'text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors',
            )}
            onClick={() => setStatusManagerOpen(v => !v)}
          >
            <SettingsIcon className="size-3.5" />
            管理状态
          </button>
        </div>
      </div>

      <div className="relative flex flex-1 overflow-hidden">
        {/* Status manager sidebar */}
        {statusManagerOpen && (
          <div className="w-72 shrink-0 border-r overflow-y-auto p-4">
            <StatusManager workspaceId={workspaceId} />
          </div>
        )}

        {/* Columns scroll area */}
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="flex flex-1 gap-4 overflow-x-auto p-4">
            {statusColumns.map(({ status, issues: colIssues }) => (
              <KanbanColumn
                key={status.id}
                status={status}
                issues={colIssues}
                milestoneMap={milestoneMap}
                workspaceId={workspaceId}
                onIssueClick={setSelectedIssue}
              />
            ))}

            {/* Unassigned column */}
            <KanbanColumn
              key="__unassigned__"
              status={null}
              issues={unassignedIssues}
              milestoneMap={milestoneMap}
              workspaceId={workspaceId}
              onIssueClick={setSelectedIssue}
            />
          </div>
        </DndContext>

        {/* Issue detail panel overlay */}
        {selectedIssue && (
          <div className="absolute inset-y-0 right-0 w-120 border-l bg-background z-10 flex flex-col overflow-hidden shadow-xl">
            <IssuePanel
              issueId={selectedIssue.id}
              workspaceId={workspaceId}
              onClose={() => setSelectedIssue(null)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
