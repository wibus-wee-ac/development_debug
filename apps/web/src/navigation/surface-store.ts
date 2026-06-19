import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { isTearoffWindow } from '~/lib/electron'

import type { AppSurface, SurfaceDraft, SurfaceRoute } from './surface-identity'
import { HOME_SURFACE, HOME_SURFACE_ID, sortSurfaces } from './surface-identity'

const SURFACE_STORAGE_KEY = 'cradle:surfaces:v1'
const LEGACY_TABS_STORAGE_KEY = 'cradle:tabs-next:v1'

interface PersistedSurfaceState {
  surfaces: AppSurface[]
  activeSurfaceId: string | null
}

interface SurfaceState extends PersistedSurfaceState {
  syncSurface: (surface: SurfaceDraft) => void
  replaceActiveSurface: (surface: SurfaceDraft) => void
  setActiveSurfaceId: (surfaceId: string) => void
  closeSurface: (surfaceId: string) => void
  reorderSurfaces: (orderedIds: string[]) => void
  updateSurfaceTitle: (surfaceId: string, title: string) => void
  resetSurfaces: () => void
}

function normalizeSurfaces(surfaces: readonly AppSurface[]): AppSurface[] {
  const byId = new Map<string, AppSurface>()
  for (const surface of surfaces) {
    byId.set(surface.id, surface)
  }
  byId.set(HOME_SURFACE_ID, {
    ...HOME_SURFACE,
    ...(byId.get(HOME_SURFACE_ID) ?? {}),
    id: HOME_SURFACE_ID,
    kind: 'home',
    route: HOME_SURFACE.route,
    closable: false,
  })

  return sortSurfaces(Array.from(byId.values())).map((surface, index) => ({
    ...surface,
    order: index,
  }))
}

function routeRecordsEqual(
  left: Record<string, string | undefined> | undefined,
  right: Record<string, string | undefined> | undefined,
): boolean {
  if (left === right) {
    return true
  }
  if (!left || !right) {
    return false
  }

  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length && leftKeys.every(key => left[key] === right[key])
}

function routesEqual(left: SurfaceRoute, right: SurfaceRoute): boolean {
  return (
    left.to === right.to
    && routeRecordsEqual(left.params, right.params)
    && routeRecordsEqual(left.search, right.search)
  )
}

function surfaceMatchesDraft(existing: AppSurface, surface: SurfaceDraft): boolean {
  return (
    existing.kind === surface.kind
    && existing.title === (existing.title || surface.title)
    && routesEqual(existing.route, surface.route)
    && existing.closable === surface.closable
  )
}

function appendOrUpdateSurface(
  surfaces: readonly AppSurface[],
  surface: SurfaceDraft,
): AppSurface[] {
  const existing = surfaces.find(item => item.id === surface.id)
  if (!existing) {
    return normalizeSurfaces([
      ...surfaces,
      {
        ...surface,
        order: surfaces.length,
      },
    ])
  }

  if (surfaceMatchesDraft(existing, surface)) {
    return surfaces as AppSurface[]
  }

  return normalizeSurfaces(
    surfaces.map(item =>
      item.id === surface.id
        ? {
            ...item,
            kind: surface.kind,
            title: item.title || surface.title,
            route: surface.route,
            closable: surface.closable,
          }
        : item),
  )
}

function mergeSurface(existing: AppSurface, surface: SurfaceDraft): AppSurface {
  const merged = {
    ...existing,
    kind: surface.kind,
    title: existing.title || surface.title,
    route: surface.route,
    closable: surface.closable,
  }
  return surfaceMatchesDraft(existing, surface) ? existing : merged
}

function replaceActiveSurface(
  surfaces: readonly AppSurface[],
  activeSurfaceId: string | null,
  surface: SurfaceDraft,
): AppSurface[] {
  const activeSurface = surfaces.find(item => item.id === activeSurfaceId)
  if (!activeSurface || !activeSurface.closable) {
    return appendOrUpdateSurface(surfaces, surface)
  }

  const existingTarget = surfaces.find(item => item.id === surface.id)
  if (existingTarget) {
    if (existingTarget.id === activeSurface.id) {
      const merged = mergeSurface(existingTarget, surface)
      if (merged === existingTarget) {
        return surfaces as AppSurface[]
      }
      return normalizeSurfaces(
        surfaces.map(item => (item.id === surface.id ? merged : item)),
      )
    }

    return normalizeSurfaces(
      surfaces
        .filter(item => item.id !== activeSurface.id || item.id === surface.id)
        .map(item => (item.id === surface.id ? mergeSurface(item, surface) : item)),
    )
  }

  return normalizeSurfaces(
    surfaces.map(item =>
      item.id === activeSurface.id
        ? {
            ...surface,
            order: activeSurface.order,
          }
        : item),
  )
}

function readFallbackSurfaceId(
  previousSurfaces: readonly AppSurface[],
  nextSurfaces: readonly AppSurface[],
  closedSurfaceId: string,
  activeSurfaceId: string | null,
): string {
  const orderedPrevious = sortSurfaces(previousSurfaces)
  const orderedNext = sortSurfaces(nextSurfaces)

  if (activeSurfaceId !== closedSurfaceId) {
    return orderedNext.some(surface => surface.id === activeSurfaceId)
      ? activeSurfaceId!
      : HOME_SURFACE_ID
  }

  const closedIndex = orderedPrevious.findIndex(surface => surface.id === closedSurfaceId)
  const next
    = orderedNext[Math.min(Math.max(closedIndex, 0), orderedNext.length - 1)] ?? orderedNext.at(-1)
  return next?.id ?? HOME_SURFACE_ID
}

function clearLegacyTabsPersistence(): void {
  try {
    window.localStorage.removeItem(LEGACY_TABS_STORAGE_KEY)
  }
  catch {}
}

export const useSurfaceStore = create<SurfaceState>()(
  persist(
    set => ({
      surfaces: [HOME_SURFACE],
      activeSurfaceId: HOME_SURFACE_ID,

      syncSurface: surface =>
        set((state) => {
          const surfaces = appendOrUpdateSurface(state.surfaces, surface)
          if (surfaces === state.surfaces && state.activeSurfaceId === surface.id) {
            return state
          }
          return {
            surfaces,
            activeSurfaceId: surface.id,
          }
        }),

      replaceActiveSurface: surface =>
        set((state) => {
          const surfaces = replaceActiveSurface(state.surfaces, state.activeSurfaceId, surface)
          if (surfaces === state.surfaces && state.activeSurfaceId === surface.id) {
            return state
          }
          return {
            surfaces,
            activeSurfaceId: surface.id,
          }
        }),

      setActiveSurfaceId: surfaceId =>
        set((state) => {
          if (
            state.activeSurfaceId === surfaceId
            || !state.surfaces.some(surface => surface.id === surfaceId)
          ) {
            return state
          }
          return { activeSurfaceId: surfaceId }
        }),

      closeSurface: surfaceId =>
        set((state) => {
          const target = state.surfaces.find(surface => surface.id === surfaceId)
          if (!target || !target.closable) {
            return state
          }

          const nextSurfaces = normalizeSurfaces(
            state.surfaces.filter(surface => surface.id !== surfaceId),
          )
          const activeSurfaceId = readFallbackSurfaceId(
            state.surfaces,
            nextSurfaces,
            surfaceId,
            state.activeSurfaceId,
          )
          return {
            surfaces: nextSurfaces,
            activeSurfaceId,
          }
        }),

      reorderSurfaces: orderedIds =>
        set((state) => {
          const rank = new Map(orderedIds.map((id, index) => [id, index]))
          const surfaces = normalizeSurfaces(
            [...state.surfaces].sort((left, right) => {
              const leftRank = rank.get(left.id) ?? Number.MAX_SAFE_INTEGER
              const rightRank = rank.get(right.id) ?? Number.MAX_SAFE_INTEGER
              return leftRank - rightRank || left.order - right.order
            }),
          )
          const unchanged
            = surfaces.length === state.surfaces.length
              && surfaces.every((surface, index) => surface.id === state.surfaces[index]?.id)
          return unchanged ? state : { surfaces }
        }),

      updateSurfaceTitle: (surfaceId, title) =>
        set((state) => {
          if (!title) {
            return state
          }
          const target = state.surfaces.find(surface => surface.id === surfaceId)
          if (!target || target.title === title) {
            return state
          }
          return {
            surfaces: state.surfaces.map(surface =>
              surface.id === surfaceId ? { ...surface, title } : surface),
          }
        }),

      resetSurfaces: () =>
        set((state) => {
          if (
            state.activeSurfaceId === HOME_SURFACE_ID
            && state.surfaces.length === 1
            && state.surfaces[0]?.id === HOME_SURFACE_ID
          ) {
            return state
          }
          return {
            surfaces: [HOME_SURFACE],
            activeSurfaceId: HOME_SURFACE_ID,
          }
        }),
    }),
    {
      name: SURFACE_STORAGE_KEY,
      storage: createJSONStorage(() => (isTearoffWindow ? sessionStorage : localStorage)),
      partialize: (state): PersistedSurfaceState => ({
        surfaces: normalizeSurfaces(state.surfaces),
        activeSurfaceId: state.activeSurfaceId,
      }),
      onRehydrateStorage: () => (state) => {
        clearLegacyTabsPersistence()
        if (!state) {
          return
        }
        state.surfaces = normalizeSurfaces(state.surfaces)
        if (
          !state.activeSurfaceId
          || !state.surfaces.some(surface => surface.id === state.activeSurfaceId)
        ) {
          state.activeSurfaceId = HOME_SURFACE_ID
        }
      },
    },
  ),
)

export function readActiveSurface(): AppSurface {
  const state = useSurfaceStore.getState()
  return state.surfaces.find(surface => surface.id === state.activeSurfaceId) ?? HOME_SURFACE
}

export function readSurface(surfaceId: string): AppSurface | null {
  return useSurfaceStore.getState().surfaces.find(surface => surface.id === surfaceId) ?? null
}
