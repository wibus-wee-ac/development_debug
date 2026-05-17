// Input: boardId, workspaceId, selectedIssueId, onSelectIssue
// Output: Main kanban view with toolbar + board/list layout + peek panel
// Position: Entry point for the kanban feature UI

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { CreateIssueDialog } from './create-issue-dialog'
import { IssueDetail } from './issue-detail'
import { IssuePeekPanel } from './issue-peek-panel'
import { KanbanBoard } from './kanban-board'
import { KanbanList } from './kanban-list'
import { KanbanToolbar } from './kanban-toolbar'
import { useIssues, useMilestones, useMoveIssue, useStatuses } from './use-kanban'
import { useViewConfig } from './use-view-config'
import type { FilterState } from './use-view-config'

interface KanbanViewProps {
  boardId: string
  workspaceId: string
  selectedIssueId?: string | null
  onSelectIssue?: (id: string | null) => void
}

export function KanbanView({ boardId: _boardId, workspaceId, selectedIssueId, onSelectIssue }: KanbanViewProps) {
  const { config, setConfig, filter, setFilter, resetFilter } = useViewConfig(workspaceId)
  const [searchQuery, setSearchQuery] = useState('')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createDefaultStatusId, setCreateDefaultStatusId] = useState<string | undefined>()

  // Peek state
  const [peekIssueId, setPeekIssueId] = useState<string | null>(null)
  const [focusedIndex, setFocusedIndex] = useState<number>(-1)
  const [hoveredIssueId, setHoveredIssueId] = useState<string | null>(null)
  const spaceDownTimeRef = useRef<number>(0)
  const peekWasOpenRef = useRef(false)
  const filteredIssuesRef = useRef<typeof allIssues>([])

  // Refs for keyboard handler (avoid stale closures + listener re-registration)
  const peekIssueIdRef = useRef<string | null>(null)
  const focusedIndexRef = useRef<number>(-1)
  const hoveredIssueIdRef = useRef<string | null>(null)
  const selectedIssueIdRef = useRef<string | null | undefined>(undefined)

  useEffect(() => { peekIssueIdRef.current = peekIssueId }, [peekIssueId])
  useEffect(() => { focusedIndexRef.current = focusedIndex }, [focusedIndex])
  useEffect(() => { hoveredIssueIdRef.current = hoveredIssueId }, [hoveredIssueId])
  useEffect(() => { selectedIssueIdRef.current = selectedIssueId }, [selectedIssueId])

  const { data: statuses = [] } = useStatuses(workspaceId)
  const { data: milestones = [] } = useMilestones(workspaceId)
  const { data: allIssues = [] } = useIssues({ workspaceId })
  const moveIssue = useMoveIssue()

  // Apply filters
  const filteredIssues = useMemo(() => {
    let result = allIssues

    if (filter.statusIds?.length) {
      result = result.filter(i => i.statusId && filter.statusIds!.includes(i.statusId))
    }
    if (filter.priorities?.length) {
      result = result.filter(i => filter.priorities!.includes(i.priority as FilterState['priorities'] extends (infer T)[] | undefined ? T : never))
    }
    if (filter.labels?.length) {
      result = result.filter(i => {
        const issueLabels: string[] = (() => { try { return JSON.parse(i.labels || '[]') } catch { return [] } })()
        return filter.labels!.some(l => issueLabels.includes(l))
      })
    }
    if (filter.milestoneId) {
      result = result.filter(i => i.milestoneId === filter.milestoneId)
    }
    if (filter.isDelegated === true) {
      result = result.filter(i => !!i.delegateAgentProfileId)
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(i =>
        i.title.toLowerCase().includes(q) || i.id.toLowerCase().includes(q),
      )
    }

    // Sort
    result = result.toSorted((a, b) => {
      const dir = config.orderDirection === 'asc' ? 1 : -1
      if (config.orderBy === 'priority') {
        const pOrder = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 }
        return dir * ((pOrder[a.priority as keyof typeof pOrder] ?? 4) - (pOrder[b.priority as keyof typeof pOrder] ?? 4))
      }
      if (config.orderBy === 'created') {
        return dir * ((a.createdAt ?? 0) - (b.createdAt ?? 0))
      }
      if (config.orderBy === 'updated') {
        return dir * ((a.updatedAt ?? 0) - (b.updatedAt ?? 0))
      }
      return dir * ((a.order ?? 0) - (b.order ?? 0))
    })

    return result
  }, [allIssues, filter, searchQuery, config.orderBy, config.orderDirection])

  const handleIssueClick = useCallback((id: string) => {
    onSelectIssue?.(id)
  }, [onSelectIssue])

  const handleMoveIssue = useCallback((issueId: string, targetGroupId: string) => {
    if (config.groupBy === 'status') {
      moveIssue.mutate({ id: issueId, statusId: targetGroupId })
    }
  }, [config.groupBy, moveIssue])

  const handleCreateIssue = useCallback((groupId: string) => {
    setCreateDefaultStatusId(config.groupBy === 'status' ? groupId : undefined)
    setCreateDialogOpen(true)
  }, [config.groupBy])

  // Keep filteredIssues ref in sync
  useEffect(() => {
    filteredIssuesRef.current = filteredIssues
  }, [filteredIssues])

  // Keyboard navigation for peek (registered once, reads from refs)
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (selectedIssueIdRef.current) return

      const target = event.target as HTMLElement | null
      if (
        target
        && (target.tagName === 'INPUT'
          || target.tagName === 'TEXTAREA'
          || target.tagName === 'SELECT'
          || target.isContentEditable
          || target.closest('[data-slot="dialog-content"], [data-slot="popover-content"], [data-slot="dropdown-menu-content"]'))
      ) {
        return
      }

      const issues = filteredIssuesRef.current
      if (issues.length === 0) return

      const curFocus = focusedIndexRef.current
      const curPeek = peekIssueIdRef.current
      const curHover = hoveredIssueIdRef.current

      // Resolve target index: keyboard focus > hover > first issue
      const resolveIndex = () => {
        if (curFocus >= 0 && curFocus < issues.length) return curFocus
        if (curHover) {
          const hoverIdx = issues.findIndex(i => i.id === curHover)
          if (hoverIdx >= 0) return hoverIdx
        }
        return 0
      }

      // J or Down arrow: move focus down
      if ((event.key === 'j' || event.key === 'ArrowDown') && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        const startIdx = resolveIndex()
        const next = Math.min(startIdx + 1, issues.length - 1)
        setFocusedIndex(next)
        if (curPeek) setPeekIssueId(issues[next]?.id ?? null)
        return
      }

      // K or Up arrow: move focus up
      if ((event.key === 'k' || event.key === 'ArrowUp') && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        const startIdx = resolveIndex()
        const next = Math.max(startIdx - 1, 0)
        setFocusedIndex(next)
        if (curPeek) setPeekIssueId(issues[next]?.id ?? null)
        return
      }

      // Space: toggle or hold peek
      if (event.key === ' ' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.repeat) {
        event.preventDefault()
        spaceDownTimeRef.current = Date.now()
        peekWasOpenRef.current = !!curPeek

        const idx = resolveIndex()
        setFocusedIndex(idx)
        setPeekIssueId(issues[idx]?.id ?? null)
        return
      }

      // Enter: open full detail from peek
      if (event.key === 'Enter' && curPeek && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        onSelectIssue?.(curPeek)
        return
      }

      // Escape: close peek
      if (event.key === 'Escape' && curPeek && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        setPeekIssueId(null)
        return
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.key === ' ') {
        const holdDuration = Date.now() - spaceDownTimeRef.current
        if (holdDuration > 300) {
          setPeekIssueId(null)
        } else if (peekWasOpenRef.current) {
          setPeekIssueId(null)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  const focusedIssueId = useMemo(() => {
    if (focusedIndex >= 0 && focusedIndex < filteredIssues.length) {
      return filteredIssues[focusedIndex].id
    }
    return null
  }, [focusedIndex, filteredIssues])

  // Follow hover when peek is active
  useEffect(() => {
    if (peekIssueId && hoveredIssueId && hoveredIssueId !== peekIssueId) {
      setPeekIssueId(hoveredIssueId)
    }
  }, [hoveredIssueId])

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden h-full">
      {selectedIssueId ? (
        <IssueDetail
          issueId={selectedIssueId}
          workspaceId={workspaceId}
          onBack={() => onSelectIssue?.(null)}
        />
      ) : (
        <>
          <KanbanToolbar
            config={config}
            setConfig={setConfig}
            filter={filter}
            setFilter={setFilter}
            resetFilter={resetFilter}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onCreateIssue={() => setCreateDialogOpen(true)}
          />

          {config.layout === 'board' ? (
            <KanbanBoard
              workspaceId={workspaceId}
              issues={filteredIssues}
              statuses={statuses}
              milestones={milestones}
              config={config}
              onIssueClick={handleIssueClick}
              onIssueHover={setHoveredIssueId}
              onMoveIssue={handleMoveIssue}
              onCreateIssue={handleCreateIssue}
            />
          ) : (
            <KanbanList
              issues={filteredIssues}
              statuses={statuses}
              milestones={milestones}
              config={config}
              selectedIssueId={focusedIssueId}
              onIssueClick={handleIssueClick}
              onIssueHover={setHoveredIssueId}
              onCreateIssue={handleCreateIssue}
            />
          )}

          <CreateIssueDialog
            workspaceId={workspaceId}
            defaultStatusId={createDefaultStatusId}
            open={createDialogOpen}
            onClose={() => setCreateDialogOpen(false)}
          />

          {/* Peek panel */}
          <IssuePeekPanel
            issueId={peekIssueId}
            workspaceId={workspaceId}
            onClose={() => setPeekIssueId(null)}
            onOpenDetail={(id) => onSelectIssue?.(id)}
          />
        </>
      )}
    </div>
  )
}
