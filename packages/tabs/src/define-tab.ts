// Input: React types
// Output: defineTab() helper and TabDefinition type
// Position: Core type definition for tab registration

import type { ComponentType } from 'react'

export interface TabDefinition<
  TType extends string = string,
  TParams extends Record<string, string | undefined> = Record<string, string | undefined>,
> {
  type: TType
  label: string | ((params: TParams) => string)
  icon?: ComponentType<{ className?: string }>
  pinned?: boolean
  component: ComponentType<{ params: TParams }>
  serialize?: (params: TParams) => string
  deserialize?: (path: string) => TParams | null
}

export function defineTab<
  TType extends string,
  TParams extends Record<string, string | undefined> = Record<string, never>,
>(config: TabDefinition<TType, TParams>): TabDefinition<TType, TParams> {
  return config
}
