import { useCallback, useEffect, useState } from 'react'
import { z } from 'zod'

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

const ViewConfigSchema = z.object({
  layout: z.enum(['board', 'list']).default('board'),
  groupBy: z.enum(['status', 'priority', 'milestone', 'assignee', 'label']).default('status'),
  orderBy: z.enum(['manual', 'priority', 'created', 'updated', 'status']).default('manual'),
  orderDirection: z.enum(['asc', 'desc']).default('asc'),
  showEmptyGroups: z.boolean().default(true),
  displayProperties: z.object({
    id: z.boolean().default(true),
    priority: z.boolean().default(true),
    status: z.boolean().default(false),
    labels: z.boolean().default(true),
    assignee: z.boolean().default(true),
    subIssueProgress: z.boolean().default(false),
    agentIndicator: z.boolean().default(true),
    milestone: z.boolean().default(false),
    dueDate: z.boolean().default(false),
    createdAt: z.boolean().default(false),
  }).default({}),
}).default({})
const ViewConfigStorageSchema = z.union([
  z.string().transform(raw => JSON.parse(raw)).pipe(ViewConfigSchema),
  z.null().transform(() => ViewConfigSchema.parse(undefined)),
])

const FilterStateSchema = z.object({
  statusIds: z.array(z.string()).optional(),
  priorities: z.array(z.enum(['none', 'low', 'medium', 'high', 'urgent'])).optional(),
  labels: z.array(z.string()).optional(),
  milestoneId: z.string().nullable().optional(),
  isDelegated: z.boolean().nullable().optional(),
}).default({})
const FilterStateStorageSchema = z.union([
  z.string().transform(raw => JSON.parse(raw)).pipe(FilterStateSchema),
  z.null().transform(() => FilterStateSchema.parse(undefined)),
])

const defaultFilter = FilterStateSchema.parse(undefined) as FilterState

export function useViewConfig(workspaceId: string) {
  const configKey = `kanban-view-config-${workspaceId}`
  const filterKey = `kanban-view-filter-${workspaceId}`

  const [config, setConfigState] = useState<ViewConfig>(() => {
    return ViewConfigStorageSchema.parse(localStorage.getItem(configKey)) as ViewConfig
  })
  const [filter, setFilterState] = useState<FilterState>(() => {
    return FilterStateStorageSchema.parse(localStorage.getItem(filterKey)) as FilterState
  })

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
