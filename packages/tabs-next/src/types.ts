import type { ComponentType, ReactNode } from 'react'

export type TabParams = Record<string, string | undefined>

export interface TabLocation<TParams extends TabParams = TabParams> {
  routeId: string
  params: TParams
  pathname: string
  search?: string
  state?: unknown
}

export interface TabHistoryEntry<TParams extends TabParams = TabParams> {
  location: TabLocation<TParams>
  title?: string
}

export type TabKeepAlivePolicy = 'default' | 'always' | 'discardable'

export interface TabInstance<TParams extends TabParams = TabParams> {
  id: string
  type: string
  params: TParams
  label: string
  pinned: boolean
}

export interface TabRouteCapabilities<TParams extends TabParams = TabParams> {
  display?: (input: { params: TParams, location: TabLocation<TParams> }) => {
    title?: string
    icon?: ComponentType<{ className?: string }>
  }
  layout?: (input: { params: TParams, location: TabLocation<TParams> }) => {
    hasAside?: boolean
    hasPanel?: boolean
  }
  status?: (input: { params: TParams, location: TabLocation<TParams> }) => {
    isRunning?: boolean
    hasUnread?: boolean
    badge?: ReactNode
  }
  restore?: (input: { params: TParams, location: TabLocation<TParams> }) => boolean
}

export interface TabRouteDefinition<
  TRouteId extends string = string,
  TParams extends TabParams = TabParams,
  TLoaderData = unknown,
> {
  id: TRouteId
  pinned?: boolean
  keepAlive?: TabKeepAlivePolicy
  icon?: ComponentType<{ className?: string }>
  component: ComponentType<{ params: TParams, loaderData?: TLoaderData }>
  title: string | ((params: TParams) => string)
  buildLocation?: (params: TParams) => TabLocation<TParams>
  matchLocation?: (location: TabLocation) => TParams | null
  serialize?: (params: TParams) => string
  deserialize?: (path: string) => TParams | null
  loader?: (params: TParams) => Promise<TLoaderData>
  loaderFallback?: ReactNode
  capabilities?: TabRouteCapabilities<TParams>
}

// eslint-disable-next-line ts/no-explicit-any
export type TabRegistry = Record<string, TabRouteDefinition<string, any, any>>

export interface TabContextState {
  id: string
  history: TabHistoryEntry[]
  index: number
  pinned: boolean
  keepAlive: TabKeepAlivePolicy
  createdAt: number
  lastActiveAt: number
  viewState: Record<string, unknown>
}

export interface OpenTabOptions {
  label?: string
  pinned?: boolean
  dedupe?: boolean
  activate?: boolean
  keepAlive?: TabKeepAlivePolicy
}

export interface NavigateTabOptions {
  replace?: boolean
  title?: string
}

export interface RestoreTabsInput {
  tabs: TabInstance[]
  activeTabId: string | null
}

export interface TabRenderPolicy {
  strategy: 'single' | 'activity-pool'
  maxMountedTabs?: number
  keepPinnedMounted?: boolean
}

export interface PersistedTabsNextState {
  version: 1
  tabs: TabInstance[]
  contexts: TabContextState[]
  activeTabId: string | null
}
