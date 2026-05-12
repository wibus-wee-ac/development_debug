// Input: boardId, workspaceId, useStatuses, useIssues, useMoveIssue, dnd-kit, IssueDetail full-page
// Output: KanbanBoardView — board with DnD columns matching BoxCrew layout
// Position: Main board view, mounted by kanban.$boardId route

import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import {
  closestCorners,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SearchIcon, SettingsIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Input } from '~/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Spinner } from '~/components/ui/spinner'
import type { KanbanIssue } from '~/lib/types'

import { CreateIssueDialog } from './create-issue-dialog'
import { IssueCard } from './issue-card'
import { IssueDetail } from './issue-detail'
import { KanbanColumn } from './kanban-column'
import { StatusManager } from './status-manager'
import { useIssues, useMoveIssue, useSearchIssues, useStatuses } from './use-kanban'

interface KanbanBoardViewProps {
  boardId: string
  workspaceId: string
  selectedIssueId?: string | null
  onSelectIssue?: (issueId: string | null) => void
}

export function KanbanBoardView({ boardId: _boardId, workspaceId, selectedIssueId, onSelectIssue }: KanbanBoardViewProps) {
  const { data: statuses = [], isLoading: loadingStatuses } = useStatuses(workspaceId)
  const { data: allIssues = [], isLoading: loadingIssues } = useIssues({ workspaceId })
  const [searchQuery, setSearchQuery] = useState('')
  const moveIssue = useMoveIssue()

  const [activeIssue, setActiveIssue] = useState<KanbanIssue | null>(null)
  const [createStatusId, setCreateStatusId] = useState<string | null>(null)

  const isLoading = loadingStatuses || loadingIssues
  const trimmedSearchQuery = searchQuery.trim()
  const { data: searchedIssues = [], isFetching: searchingIssues } = useSearchIssues(trimmedSearchQuery, 100, trimmedSearchQuery.length > 0)

  const visibleIssues = useMemo(() => {
    if (!trimmedSearchQuery) {
      return allIssues
    }

    const matchedIds = new Set(
      searchedIssues
        .filter(issue => issue.workspaceId === workspaceId)
        .map(issue => issue.id),
    )

    return allIssues.filter(issue => matchedIds.has(issue.id))
  }, [allIssues, searchedIssues, trimmedSearchQuery, workspaceId])

  // Group issues by status
  const issuesByStatus = useMemo(() => {
    const map = new Map<string, KanbanIssue[]>()
    for (const s of statuses) {
      map.set(s.id, [])
    }
    map.set('__none__', [])
    for (const issue of visibleIssues) {
      if (!issue.parentIssueId) {
        const bucket = issue.statusId ? (map.get(issue.statusId) ?? map.get('__none__')!) : map.get('__none__')!
        bucket.push(issue)
      }
    }
    return map
  }, [statuses, visibleIssues])

  // DnD sensors — PointerSensor with distance 8 (like BoxCrew)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
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

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  const hasUnassigned = (issuesByStatus.get('__none__')?.length ?? 0) > 0
  const totalIssues = allIssues.filter(i => !i.parentIssueId).length
  const visibleIssueCount = visibleIssues.filter(i => !i.parentIssueId).length
  const showSearchEmpty = trimmedSearchQuery.length > 0 && !searchingIssues && visibleIssueCount === 0

  return (
    <div className="relative flex h-full flex-1 flex-col overflow-hidden" data-testid="kanban-board">
      <AnimatePresence mode="popLayout">
        {selectedIssueId
          ? (
            <motion.div
              key={`issue-${selectedIssueId}`}
              className="absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
            >
              <IssueDetail
                issueId={selectedIssueId}
                workspaceId={workspaceId}
                onClose={() => onSelectIssue?.(null)}
                onNavigateToIssue={id => onSelectIssue?.(id)}
              />
            </motion.div>
          )
          : (
            <motion.div
              key="board"
              className="flex h-full flex-1 flex-col"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
            >
              {/* Toolbar */}
              <div className="flex items-center justify-between px-6 pt-2.5 shrink-0">
                <div className="flex items-center gap-3">
                  <span className="text-[13px] text-muted-foreground" data-testid="kanban-issue-count">
                    {trimmedSearchQuery ? `${visibleIssueCount}/${totalIssues}` : totalIssues}
                    {' '}
                    issues
                  </span>
                  <div className="relative w-56">
                    <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/45" />
                    <Input
                      value={searchQuery}
                      onChange={event => setSearchQuery(event.target.value)}
                      placeholder="Search issues"
                      data-testid="kanban-search-input"
                      className="h-7 border-border/40 bg-background/70 pl-7 pr-7 text-xs shadow-none"
                    />
                    {searchingIssues && (
                      <Spinner className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/45" />
                    )}
                  </div>
                </div>
                <Popover>
                  <PopoverTrigger className="text-muted-foreground/50 hover:text-foreground transition-colors duration-100 p-1 rounded-md hover:bg-accent/50" data-testid="kanban-settings-btn">
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
                {showSearchEmpty && (
                  <div className="px-6 pt-4" data-testid="kanban-search-empty">
                    <p className="text-[12px] text-muted-foreground">
                      No issues match “
                      {trimmedSearchQuery}
                      ”
                    </p>
                  </div>
                )}
                <div className="flex flex-1 gap-3 overflow-x-auto p-6 pb-0 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                  {statuses.map(status => (
                    <KanbanColumn
                      key={status.id}
                      status={status}
                      issues={issuesByStatus.get(status.id) ?? []}
                      onIssueClick={handleIssueClick}
                      onOpenCreate={setCreateStatusId}
                      selectedIssueId={selectedIssueId}
                      isLoading={loadingIssues}
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

                <DragOverlay>
                  {activeIssue && (
                    <IssueCard issue={activeIssue} onClick={() => { }} isDragging />
                  )}
                </DragOverlay>
              </DndContext>
            </motion.div>
          )}
      </AnimatePresence>
    </div>
  )
}
