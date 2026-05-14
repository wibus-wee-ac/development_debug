// Input: workspaceId, localStorage
// Output: View configuration state hook for kanban layout, grouping, sorting, filtering
// Position: State layer for kanban view preferences

import { useCallback, useEffect, useState } from 'react'

export type StatusCategory = 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'

export interface ViewConfig {
  layout: 'board' | 'list'
  groupBy: 'status' | 'priority' | 'milestone' | 'assignee' | 'label'
  orderBy: 'manual' | 'priority' | 'created' | 'updated' | 'status'
  orderDirection: 'asc' | 'desc'
  showEmptyGroups: boolean
  displayProperties: {
    id: boolean
    priority: boolean
    status: boolean
    labels: boolean
    assignee: boolean
    subIssueProgress: boolean
    agentIndicator: boolean
    milestone: boolean
    dueDate: boolean
    createdAt: boolean
  }
}

export interface FilterState {
  statusIds?: string[]
  priorities?: ('none' | 'low' | 'medium' | 'high' | 'urgent')[]
  labels?: string[]
  milestoneId?: string | null
  isDelegated?: boolean | null
}

const defaultConfig: ViewConfig = {
  layout: 'board',
  groupBy: 'status',
  orderBy: 'manual',
  orderDirection: 'asc',
  showEmptyGroups: true,
  displayProperties: {
    id: true,
    priority: true,
    status: false,
    labels: true,
    assignee: true,
    subIssueProgress: false,
    agentIndicator: true,
    milestone: false,
    dueDate: false,
    createdAt: false,
  },
}

const defaultFilter: FilterState = {}

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw) as T
  } catch { /* ignore */ }
  return fallback
}

export function useViewConfig(workspaceId: string) {
  const configKey = `kanban-view-config-${workspaceId}`
  const filterKey = `kanban-view-filter-${workspaceId}`

  const [config, setConfigState] = useState<ViewConfig>(() => loadFromStorage(configKey, defaultConfig))
  const [filter, setFilterState] = useState<FilterState>(() => loadFromStorage(filterKey, defaultFilter))

  useEffect(() => {
    localStorage.setItem(configKey, JSON.stringify(config))
  }, [config, configKey])

  useEffect(() => {
    localStorage.setItem(filterKey, JSON.stringify(filter))
  }, [filter, filterKey])

  const setConfig = useCallback((patch: Partial<ViewConfig>) => {
    setConfigState(prev => ({ ...prev, ...patch }))
  }, [])

  const setFilter = useCallback((patch: Partial<FilterState>) => {
    setFilterState(prev => ({ ...prev, ...patch }))
  }, [])

  const resetFilter = useCallback(() => {
    setFilterState(defaultFilter)
  }, [])

  return { config, setConfig, filter, setFilter, resetFilter }
}
