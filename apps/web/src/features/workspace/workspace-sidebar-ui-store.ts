import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { persistStorage } from '~/store/persist-storage'

type WorkspaceSidebarFlagMap = Record<string, true>

export type WorkspaceSidebarProjectSortKey = 'name' | 'updatedAt' | 'createdAt'
export type WorkspaceSidebarProjectSortDirection = 'asc' | 'desc'
export type WorkspaceSidebarProjectFilter = 'all' | 'pinned' | 'unpinned' | 'unread' | 'running'

interface WorkspaceSidebarUiState {
  collapsedWorkspaceIds: WorkspaceSidebarFlagMap
  expandedSessionListWorkspaceIds: WorkspaceSidebarFlagMap
  projectFilter: WorkspaceSidebarProjectFilter
  projectSortKey: WorkspaceSidebarProjectSortKey
  projectSortDirection: WorkspaceSidebarProjectSortDirection
  projectPinnedFirst: boolean
  setProjectFilter: (filter: WorkspaceSidebarProjectFilter) => void
  setProjectSortKey: (sortKey: WorkspaceSidebarProjectSortKey) => void
  setProjectSortDirection: (sortDirection: WorkspaceSidebarProjectSortDirection) => void
  setProjectPinnedFirst: (pinnedFirst: boolean) => void
  setWorkspaceExpanded: (workspaceId: string, expanded: boolean) => void
  toggleWorkspaceExpanded: (workspaceId: string) => void
  setWorkspaceSessionListExpanded: (workspaceId: string, expanded: boolean) => void
  toggleWorkspaceSessionListExpanded: (workspaceId: string) => void
  pruneWorkspaceSidebarState: (workspaceIds: readonly string[]) => void
}

interface PersistedWorkspaceSidebarUiState {
  collapsedWorkspaceIds?: WorkspaceSidebarFlagMap
  expandedSessionListWorkspaceIds?: WorkspaceSidebarFlagMap
  projectFilter?: unknown
  projectSortKey?: unknown
  projectSortDirection?: unknown
  projectPinnedFirst?: unknown
}

const PROJECT_FILTERS = new Set<WorkspaceSidebarProjectFilter>(['all', 'pinned', 'unpinned', 'unread', 'running'])
const PROJECT_SORT_KEYS = new Set<WorkspaceSidebarProjectSortKey>(['name', 'updatedAt', 'createdAt'])
const PROJECT_SORT_DIRECTIONS = new Set<WorkspaceSidebarProjectSortDirection>(['asc', 'desc'])

function setFlag(map: WorkspaceSidebarFlagMap, key: string, enabled: boolean): WorkspaceSidebarFlagMap {
  if (enabled) {
    if (map[key]) {
      return map
    }
    return { ...map, [key]: true }
  }

  if (!map[key]) {
    return map
  }
  const { [key]: _removed, ...next } = map
  return next
}

function pruneFlags(map: WorkspaceSidebarFlagMap, allowedIds: ReadonlySet<string>): WorkspaceSidebarFlagMap {
  let changed = false
  const next: WorkspaceSidebarFlagMap = {}

  for (const [workspaceId, enabled] of Object.entries(map)) {
    if (enabled && allowedIds.has(workspaceId)) {
      next[workspaceId] = true
    }
    else {
      changed = true
    }
  }

  return changed ? next : map
}

function normalizeFlags(value: unknown): WorkspaceSidebarFlagMap {
  if (!value || typeof value !== 'object') {
    return {}
  }

  const flags: WorkspaceSidebarFlagMap = {}
  for (const [workspaceId, enabled] of Object.entries(value)) {
    if (enabled === true) {
      flags[workspaceId] = true
    }
  }
  return flags
}

function normalizeProjectFilter(value: unknown): WorkspaceSidebarProjectFilter {
  return typeof value === 'string' && PROJECT_FILTERS.has(value as WorkspaceSidebarProjectFilter)
    ? value as WorkspaceSidebarProjectFilter
    : 'all'
}

function normalizeProjectSortKey(value: unknown): WorkspaceSidebarProjectSortKey {
  return typeof value === 'string' && PROJECT_SORT_KEYS.has(value as WorkspaceSidebarProjectSortKey)
    ? value as WorkspaceSidebarProjectSortKey
    : 'name'
}

function normalizeProjectSortDirection(value: unknown): WorkspaceSidebarProjectSortDirection {
  return typeof value === 'string' && PROJECT_SORT_DIRECTIONS.has(value as WorkspaceSidebarProjectSortDirection)
    ? value as WorkspaceSidebarProjectSortDirection
    : 'asc'
}

export const useWorkspaceSidebarUiStore = create<WorkspaceSidebarUiState>()(
  persist(
    set => ({
      collapsedWorkspaceIds: {},
      expandedSessionListWorkspaceIds: {},
      projectFilter: 'all',
      projectSortKey: 'name',
      projectSortDirection: 'asc',
      projectPinnedFirst: true,
      setProjectFilter: projectFilter => set(state => state.projectFilter === projectFilter ? state : { projectFilter }),
      setProjectSortKey: projectSortKey => set(state => state.projectSortKey === projectSortKey ? state : { projectSortKey }),
      setProjectSortDirection: projectSortDirection => set(state => state.projectSortDirection === projectSortDirection ? state : { projectSortDirection }),
      setProjectPinnedFirst: projectPinnedFirst => set(state => state.projectPinnedFirst === projectPinnedFirst ? state : { projectPinnedFirst }),
      setWorkspaceExpanded: (workspaceId, expanded) => set((state) => {
        const collapsedWorkspaceIds = setFlag(state.collapsedWorkspaceIds, workspaceId, !expanded)
        return collapsedWorkspaceIds === state.collapsedWorkspaceIds ? state : { collapsedWorkspaceIds }
      }),
      toggleWorkspaceExpanded: workspaceId => set((state) => {
        const expanded = state.collapsedWorkspaceIds[workspaceId] !== true
        return {
          collapsedWorkspaceIds: setFlag(state.collapsedWorkspaceIds, workspaceId, expanded),
        }
      }),
      setWorkspaceSessionListExpanded: (workspaceId, expanded) => set((state) => {
        const expandedSessionListWorkspaceIds = setFlag(state.expandedSessionListWorkspaceIds, workspaceId, expanded)
        return expandedSessionListWorkspaceIds === state.expandedSessionListWorkspaceIds ? state : { expandedSessionListWorkspaceIds }
      }),
      toggleWorkspaceSessionListExpanded: workspaceId => set((state) => {
        const expanded = state.expandedSessionListWorkspaceIds[workspaceId] !== true
        return {
          expandedSessionListWorkspaceIds: setFlag(state.expandedSessionListWorkspaceIds, workspaceId, expanded),
        }
      }),
      pruneWorkspaceSidebarState: workspaceIds => set((state) => {
        const allowedIds = new Set(workspaceIds)
        const collapsedWorkspaceIds = pruneFlags(state.collapsedWorkspaceIds, allowedIds)
        const expandedSessionListWorkspaceIds = pruneFlags(state.expandedSessionListWorkspaceIds, allowedIds)
        if (
          collapsedWorkspaceIds === state.collapsedWorkspaceIds
          && expandedSessionListWorkspaceIds === state.expandedSessionListWorkspaceIds
        ) {
          return state
        }
        return {
          collapsedWorkspaceIds,
          expandedSessionListWorkspaceIds,
        }
      }),
    }),
    {
      name: 'cradle:workspace-sidebar-ui:v1',
      storage: persistStorage,
      version: 1,
      partialize: state => ({
        collapsedWorkspaceIds: state.collapsedWorkspaceIds,
        expandedSessionListWorkspaceIds: state.expandedSessionListWorkspaceIds,
        projectFilter: state.projectFilter,
        projectSortKey: state.projectSortKey,
        projectSortDirection: state.projectSortDirection,
        projectPinnedFirst: state.projectPinnedFirst,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as PersistedWorkspaceSidebarUiState
        return {
          ...currentState,
          collapsedWorkspaceIds: normalizeFlags(persisted?.collapsedWorkspaceIds),
          expandedSessionListWorkspaceIds: normalizeFlags(persisted?.expandedSessionListWorkspaceIds),
          projectFilter: normalizeProjectFilter(persisted?.projectFilter),
          projectSortKey: normalizeProjectSortKey(persisted?.projectSortKey),
          projectSortDirection: normalizeProjectSortDirection(persisted?.projectSortDirection),
          projectPinnedFirst: typeof persisted?.projectPinnedFirst === 'boolean' ? persisted.projectPinnedFirst : true,
        }
      },
    },
  ),
)
