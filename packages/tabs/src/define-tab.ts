// Input: React types
// Output: defineTab() helper and TabDefinition type
// Position: Core type definition for tab registration

import type { ComponentType, ReactNode } from 'react'

export interface TabDefinition<
  TType extends string = string,
  TParams extends Record<string, string | undefined> = Record<string, string | undefined>,
  TLoaderData = unknown,
> {
  type: TType
  label: string | ((params: TParams) => string)
  icon?: ComponentType<{ className?: string }>
  pinned?: boolean
  component: ComponentType<{ params: TParams, loaderData?: TLoaderData }>
  /**
   * Async data loader — runs before the component renders.
   * Re-runs when params change (shallow comparison).
   */
  loader?: (params: TParams) => Promise<TLoaderData>
  /** Fallback shown while the loader is pending */
  loaderFallback?: ReactNode
  serialize?: (params: TParams) => string
  deserialize?: (path: string) => TParams | null
}

export function defineTab<
  TType extends string,
  TParams extends Record<string, string | undefined> = Record<string, never>,
  TLoaderData = unknown,
>(config: TabDefinition<TType, TParams, TLoaderData>): TabDefinition<TType, TParams, TLoaderData> {
  return config
}
