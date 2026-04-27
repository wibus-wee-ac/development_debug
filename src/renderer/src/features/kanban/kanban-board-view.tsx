// Input: boardId, workspaceId, useStatuses, useIssues, useMoveIssue, dnd-kit, IssueDetail panel
// Output: KanbanBoardView — board with DnD columns and integrated issue detail panel
// Position: Main board view, mounted by kanban.$boardId route

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
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { Spinner } from '@renderer/components/ui/spinner'
import { cn } from '@renderer/lib/cn'
import { SettingsIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { CreateIssueDialog } from './create-issue-dialog'
import { IssueCard } from './issue-card'
import { IssueDetail } from './issue-detail'
import { KanbanColumn } from './kanban-column'
import { StatusManager } from './status-manager'
import { useIssues, useMoveIssue, useStatuses } from './use-kanban'

interface KanbanBoardViewProps {
  boardId: string
  workspaceId: string
  selectedIssueId?: string | null
  onSelectIssue?: (issueId: string | null) => void
}

export function KanbanBoardView({ boardId: _boardId, workspaceId, selectedIssueId, onSelectIssue }: KanbanBoardViewProps) {
  const { data: statuses = [], isLoading: loadingStatuses } = useStatuses(workspaceId)
  const { data: allIssues = [], isLoading: loadingIssues } = useIssues({ workspaceId })
  const moveIssue = useMoveIssue()

  const [activeIssue, setActiveIssue] = useState<KanbanIssue | null>(null)
  const [createStatusId, setCreateStatusId] = useState<string | null>(null)
  const [panelWidth, setPanelWidth] = useState(420)
  const [isResizing, setIsResizing] = useState(false)
  const resizeRef = useRef<{ startX: number, startWidth: number } | null>(null)

  // Group issues by status
  const issuesByStatus = useMemo(() => {
    const map = new Map<string, KanbanIssue[]>()
    for (const s of statuses) {
      map.set(s.id, [])
    }
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
    const issue = event.active.data.current?.issue as KanbanIssue | undefined
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
    onSelectIssue?.(issue.id)
  }, [onSelectIssue])

  // Resize panel handle
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    resizeRef.current = { startX: e.clientX, startWidth: panelWidth }

    function onMouseMove(ev: MouseEvent) {
      if (!resizeRef.current) {
        return
      }
      const delta = resizeRef.current.startX - ev.clientX
      const newWidth = Math.min(640, Math.max(340, resizeRef.current.startWidth + delta))
      setPanelWidth(newWidth)
    }

    function onMouseUp() {
      setIsResizing(false)
      resizeRef.current = null
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [panelWidth])

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && selectedIssueId) {
        onSelectIssue?.(null)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedIssueId, onSelectIssue])

  if (loadingStatuses || loadingIssues) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  const hasUnassigned = (issuesByStatus.get('__none__')?.length ?? 0) > 0

  return (
    <div className="flex h-full">
      {/* Board area */}
      <div className="flex flex-1 min-w-0 flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 h-10 shrink-0">
          <div className="flex-1" />
          <Popover>
            <PopoverTrigger className="text-muted-foreground/30 hover:text-foreground transition-colors duration-100">
              <SettingsIcon className="size-3.5" />
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end" className="w-64">
              <StatusManager workspaceId={workspaceId} />
            </PopoverContent>
          </Popover>
        </div>

        <CreateIssueDialog
          open={createStatusId !== null}
          onOpenChange={(open: boolean) => {
            if (!open) {
              setCreateStatusId(null)
            }
          }}
          workspaceId={workspaceId}
          defaultStatusId={createStatusId}
        />

        {/* Columns */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex flex-1 gap-0.5 overflow-x-auto overflow-y-hidden px-2 pb-2">
            {statuses.map(status => (
              <KanbanColumn
                key={status.id}
                status={status}
                issues={issuesByStatus.get(status.id) ?? []}
                onIssueClick={handleIssueClick}
                onOpenCreate={setCreateStatusId}
                selectedIssueId={selectedIssueId}
              />
            ))}

            {hasUnassigned && (
              <KanbanColumn
                status={{ id: '__none__', workspaceId, name: 'Unassigned', color: null, order: 999, createdAt: 0 }}
                issues={issuesByStatus.get('__none__') ?? []}
                onIssueClick={handleIssueClick}
                onOpenCreate={setCreateStatusId}
                selectedIssueId={selectedIssueId}
              />
            )}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeIssue && (
              <div className="w-64 rounded-lg bg-background inset-shadow-[0_1px_0_var(--color-foreground)/0.06]">
                <IssueCard issue={activeIssue} onClick={() => { }} isDragging />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Issue detail panel */}
      <AnimatePresence mode="popLayout">
        {selectedIssueId && (
          <motion.div
            key={selectedIssueId}
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: panelWidth, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={isResizing ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 35 }}
            className="h-full shrink-0 overflow-hidden relative"
          >
            {/* Resize handle */}
            <div
              className={cn(
                'absolute left-0 top-0 bottom-0 w-px bg-foreground/6 z-10 cursor-col-resize',
                'hover:bg-foreground/15 active:bg-foreground/20',
                'transition-colors duration-100',
                isResizing && 'bg-foreground/20',
              )}
              onMouseDown={handleResizeStart}
            >
              <div className="absolute -left-1.5 top-0 bottom-0 w-3" />
            </div>

            <IssueDetail
              issueId={selectedIssueId}
              workspaceId={workspaceId}
              onClose={() => onSelectIssue?.(null)}
              onNavigateToIssue={id => onSelectIssue?.(id)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
