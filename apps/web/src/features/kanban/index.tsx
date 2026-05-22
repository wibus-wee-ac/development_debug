import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { markCradlePerformance, measureCradlePerformance } from '~/lib/perf-monitor'

import { CreateIssueDialog } from './create-issue-dialog'
import { IssueDetail } from './issue-detail'
import { IssuePeekPanel } from './issue-peek-panel'
import { KanbanBoard } from './kanban-board'
import { KanbanList } from './kanban-list'
import type { IssueSelectionMode } from './kanban-selection'
import { addIssueSelectionRange, orderedIssuesForKanbanView, toggleIssueSelection } from './kanban-selection'
import { KanbanSelectionBar } from './kanban-selection-bar'
import { KanbanToolbar } from './kanban-toolbar'
import { useIssues, useMilestones, useMoveIssue, useStatuses } from './use-kanban'
import type { FilterState } from './use-view-config'
import { useViewConfig } from './use-view-config'

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
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(() => new Set())
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null)

  // Peek state
  const [peekIssueId, setPeekIssueId] = useState<string | null>(null)
  const [focusedIndex, setFocusedIndex] = useState<number>(-1)
  const [hoveredIssueId, setHoveredIssueId] = useState<string | null>(null)
  const spaceDownTimeRef = useRef<number>(0)
  const peekWasOpenRef = useRef(false)
  const visibleIssuesRef = useRef<typeof allIssues>([])
  const firstRenderedWorkspaceIdRef = useRef<string | null>(null)

  // Refs for keyboard handler (avoid stale closures + listener re-registration)
  const peekIssueIdRef = useRef<string | null>(null)
  const focusedIndexRef = useRef<number>(-1)
  const hoveredIssueIdRef = useRef<string | null>(null)
  const selectedIssueIdRef = useRef<string | null | undefined>(undefined)
  const selectedIssueIdsRef = useRef<Set<string>>(selectedIssueIds)
  const selectionAnchorIdRef = useRef<string | null>(selectionAnchorId)
  const onSelectIssueRef = useRef(onSelectIssue)

  useEffect(() => {
    peekIssueIdRef.current = peekIssueId
  }, [peekIssueId])
  useEffect(() => {
    focusedIndexRef.current = focusedIndex
  }, [focusedIndex])
  useEffect(() => {
    hoveredIssueIdRef.current = hoveredIssueId
  }, [hoveredIssueId])
  useEffect(() => {
    selectedIssueIdRef.current = selectedIssueId
  }, [selectedIssueId])
  useEffect(() => {
    selectedIssueIdsRef.current = selectedIssueIds
  }, [selectedIssueIds])
  useEffect(() => {
    selectionAnchorIdRef.current = selectionAnchorId
  }, [selectionAnchorId])
  useEffect(() => {
    onSelectIssueRef.current = onSelectIssue
  }, [onSelectIssue])

  const { data: statuses = [], isSuccess: statusesReady } = useStatuses(workspaceId)
  const { data: milestones = [], isSuccess: milestonesReady } = useMilestones(workspaceId)
  const { data: allIssues = [], isSuccess: issuesReady } = useIssues({ workspaceId })
  const moveIssue = useMoveIssue()

  useEffect(() => {
    if (
      firstRenderedWorkspaceIdRef.current === workspaceId
      || !statusesReady
      || !milestonesReady
      || !issuesReady
    ) {
      return
    }

    firstRenderedWorkspaceIdRef.current = workspaceId
    markCradlePerformance('cradle:first-kanban-rendered')
    measureCradlePerformance(
      'cradle:kanban-first-render',
      'cradle:kanban-render-requested',
      'cradle:first-kanban-rendered',
    )
  }, [issuesReady, milestonesReady, statusesReady, workspaceId])

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
      result = result.filter(i => filter.labels!.some(l => i.labels.includes(l)))
    }
    if (filter.milestoneId) {
      result = result.filter(i => i.milestoneId === filter.milestoneId)
    }
    if (filter.isDelegated === true) {
      result = result.filter(i => !!i.delegateAgentId || !!i.delegateAgentProfileId)
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(i =>
        i.title.toLowerCase().includes(q) || i.id.toLowerCase().includes(q))
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

  const visibleIssues = useMemo(
    () => orderedIssuesForKanbanView(filteredIssues, statuses, milestones, config),
    [filteredIssues, statuses, milestones, config],
  )

  const visibleIssueIds = useMemo(() => visibleIssues.map(issue => issue.id), [visibleIssues])

  const selectedIssues = useMemo(
    () => visibleIssues.filter(issue => selectedIssueIds.has(issue.id)),
    [visibleIssues, selectedIssueIds],
  )

  const clearSelectedIssues = useCallback(() => {
    setSelectedIssueIds(new Set())
    setSelectionAnchorId(null)
    setFocusedIndex(-1)
    setPeekIssueId(null)
  }, [])

  const selectAllVisibleIssues = useCallback(() => {
    if (visibleIssuesRef.current.length === 0) {
      return
    }
    setSelectedIssueIds(new Set(visibleIssuesRef.current.map(issue => issue.id)))
    setSelectionAnchorId(visibleIssuesRef.current[0]?.id ?? null)
  }, [])

  const extendSelectionToIssue = useCallback((issueId: string) => {
    const issueIds = visibleIssuesRef.current.map(issue => issue.id)
    const fallbackAnchorId = selectionAnchorIdRef.current
      ?? [...selectedIssueIdsRef.current][0]
      ?? issueId

    setSelectedIssueIds(prev => addIssueSelectionRange(prev, issueIds, fallbackAnchorId, issueId))
    setSelectionAnchorId(fallbackAnchorId)
  }, [])

  const toggleIssueSelected = useCallback((issueId: string) => {
    const next = toggleIssueSelection(selectedIssueIdsRef.current, issueId)
    selectedIssueIdsRef.current = next
    setSelectedIssueIds(next)
    setSelectionAnchorId(next.has(issueId) ? issueId : ([...next][0] ?? null))
    if (!next.has(issueId)) {
      setFocusedIndex(-1)
    }
  }, [])

  const handleIssueSelectionGesture = useCallback((issueId: string, mode: IssueSelectionMode) => {
    const index = visibleIssuesRef.current.findIndex(issue => issue.id === issueId)
    if (index >= 0) {
      setFocusedIndex(index)
    }
    if (mode === 'range') {
      extendSelectionToIssue(issueId)
      return
    }
    toggleIssueSelected(issueId)
  }, [extendSelectionToIssue, toggleIssueSelected])

  // Keep visible issue order ref in sync with the rendered group layout.
  useEffect(() => {
    visibleIssuesRef.current = visibleIssues
  }, [visibleIssues])

  useEffect(() => {
    setSelectedIssueIds((prev) => {
      const visibleIds = new Set(visibleIssueIds)
      const next = new Set([...prev].filter(id => visibleIds.has(id)))
      return next.size === prev.size ? prev : next
    })
    if (selectionAnchorId && !visibleIssueIds.includes(selectionAnchorId)) {
      setSelectionAnchorId(null)
    }
  }, [selectionAnchorId, visibleIssueIds])

  // Keyboard navigation for peek and multi-selection
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (selectedIssueIdRef.current) {
        return
      }

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

      const issues = visibleIssuesRef.current
      if (issues.length === 0) {
        return
      }

      const curFocus = focusedIndexRef.current
      const curPeek = peekIssueIdRef.current
      const curHover = hoveredIssueIdRef.current
      const curSelectedIds = selectedIssueIdsRef.current

      // Resolve target index: keyboard focus > hover > first issue
      const resolveIndex = () => {
        if (curFocus >= 0 && curFocus < issues.length) {
          return curFocus
        }
        if (curHover) {
          const hoverIdx = issues.findIndex(i => i.id === curHover)
          if (hoverIdx >= 0) {
            return hoverIdx
          }
        }
        return 0
      }

      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        selectAllVisibleIssues()
        return
      }

      if (event.key === 'Escape' && curSelectedIds.size > 0 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        clearSelectedIssues()
        return
      }

      if (event.key.toLowerCase() === 'x' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        const idx = resolveIndex()
        const issueId = issues[idx]?.id
        if (!issueId) {
          return
        }
        setFocusedIndex(idx)
        if (event.shiftKey) {
          extendSelectionToIssue(issueId)
          return
        }
        toggleIssueSelected(issueId)
        return
      }

      if (
        event.shiftKey
        && !event.metaKey
        && !event.ctrlKey
        && !event.altKey
        && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key.toLowerCase() === 'j' || event.key.toLowerCase() === 'k')
      ) {
        event.preventDefault()
        const startIdx = resolveIndex()
        const next = event.key === 'ArrowDown' || event.key.toLowerCase() === 'j'
          ? Math.min(startIdx + 1, issues.length - 1)
          : Math.max(startIdx - 1, 0)
        setFocusedIndex(next)
        if (curPeek) {
          setPeekIssueId(issues[next]?.id ?? null)
        }
        const issueId = issues[next]?.id
        if (issueId) {
          if (curSelectedIds.size === 0) {
            const anchorIssueId = issues[startIdx]?.id ?? issueId
            setSelectedIssueIds(new Set([anchorIssueId]))
            setSelectionAnchorId(anchorIssueId)
          }
          extendSelectionToIssue(issueId)
        }
        return
      }

      // J or Down arrow: move focus down
      if ((event.key === 'j' || event.key === 'ArrowDown') && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        const startIdx = resolveIndex()
        const next = Math.min(startIdx + 1, issues.length - 1)
        setFocusedIndex(next)
        if (curPeek) {
          setPeekIssueId(issues[next]?.id ?? null)
        }
        return
      }

      // K or Up arrow: move focus up
      if ((event.key === 'k' || event.key === 'ArrowUp') && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        const startIdx = resolveIndex()
        const next = Math.max(startIdx - 1, 0)
        setFocusedIndex(next)
        if (curPeek) {
          setPeekIssueId(issues[next]?.id ?? null)
        }
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
        onSelectIssueRef.current?.(curPeek)
        return
      }

      // Escape: close peek
      if (event.key === 'Escape' && curPeek && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        setPeekIssueId(null)
        setFocusedIndex(-1)
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.key === ' ') {
        const holdDuration = Date.now() - spaceDownTimeRef.current
        if (holdDuration > 300) {
          setPeekIssueId(null)
          setFocusedIndex(-1)
        }
 else if (peekWasOpenRef.current) {
          setPeekIssueId(null)
          setFocusedIndex(-1)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [clearSelectedIssues, extendSelectionToIssue, selectAllVisibleIssues, toggleIssueSelected])

  const focusedIssueId = useMemo(() => {
    if (focusedIndex >= 0 && focusedIndex < visibleIssues.length) {
      return visibleIssues[focusedIndex].id
    }
    return null
  }, [focusedIndex, visibleIssues])

  // Follow hover when peek is active
  useEffect(() => {
    if (peekIssueId && hoveredIssueId && hoveredIssueId !== peekIssueId) {
      setPeekIssueId(hoveredIssueId)
      // Sync focusedIndex so next keyboard nav starts from the hovered issue
      const idx = visibleIssues.findIndex(i => i.id === hoveredIssueId)
      if (idx >= 0) {
        setFocusedIndex(idx)
      }
    }
  }, [hoveredIssueId, peekIssueId, visibleIssues])

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden h-full">
      {/* eslint-disable-next-line style/multiline-ternary */}
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

          {config.layout === 'board'
? (
            <KanbanBoard
              workspaceId={workspaceId}
              issues={filteredIssues}
              statuses={statuses}
              milestones={milestones}
              config={config}
              onIssueClick={handleIssueClick}
              onIssueSelectionGesture={handleIssueSelectionGesture}
              onIssueHover={setHoveredIssueId}
              onMoveIssue={handleMoveIssue}
              onCreateIssue={handleCreateIssue}
              highlightedIssueId={focusedIssueId}
              selectedIssueIds={selectedIssueIds}
            />
          )
: (
            <KanbanList
              issues={filteredIssues}
              statuses={statuses}
              milestones={milestones}
              config={config}
              highlightedIssueId={focusedIssueId}
              selectedIssueIds={selectedIssueIds}
              onIssueClick={handleIssueClick}
              onIssueSelectionGesture={handleIssueSelectionGesture}
              onIssueHover={setHoveredIssueId}
              onCreateIssue={handleCreateIssue}
            />
          )}

          <KanbanSelectionBar
            issues={selectedIssues}
            statuses={statuses}
            onClear={clearSelectedIssues}
          />

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
            onOpenDetail={id => onSelectIssue?.(id)}
          />
        </>
      )}
    </div>
  )
}
