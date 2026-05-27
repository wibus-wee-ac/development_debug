import type { TabLocation, TabParams, TabRouteDefinition } from './types'

export function defineTab<
  TRouteId extends string,
  TParams extends TabParams = Record<string, never>,
  TLoaderData = unknown,
>(config: Omit<TabRouteDefinition<TRouteId, TParams, TLoaderData>, 'id' | 'title'> & {
  type: TRouteId
  label: string | ((params: TParams) => string)
}): TabRouteDefinition<TRouteId, TParams, TLoaderData> {
  return {
    ...config,
    id: config.type,
    title: config.label,
  }
}

export function createTabLocation<TParams extends TabParams>(
  routeId: string,
  params: TParams,
): TabLocation<TParams> {
  return {
    routeId,
    params,
    pathname: `/${routeId}`,
  }
}

export function resolveRouteTitle<TParams extends TabParams>(
  route: TabRouteDefinition<string, TParams, unknown>,
  params: TParams,
  fallback?: string,
): string {
  if (fallback) {
    return fallback
  }
  return typeof route.title === 'function' ? route.title(params) : route.title
}

export function resolveLocation<TParams extends TabParams>(
  route: TabRouteDefinition<string, TParams, unknown>,
  params: TParams,
): TabLocation<TParams> {
  return route.buildLocation?.(params) ?? createTabLocation(route.id, params)
}
