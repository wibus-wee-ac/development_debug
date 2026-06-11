import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { isTearoffWindow } from '~/lib/electron'

import type { AppSurface, SurfaceDraft } from './surface-identity'
import { HOME_SURFACE, HOME_SURFACE_ID, sortSurfaces } from './surface-identity'

const SURFACE_STORAGE_KEY = 'cradle:surfaces:v1'
const LEGACY_TABS_STORAGE_KEY = 'cradle:tabs-next:v1'

interface PersistedSurfaceState {
  surfaces: AppSurface[]
  activeSurfaceId: string | null
}

interface SurfaceState extends PersistedSurfaceState {
  syncSurface: (surface: SurfaceDraft) => void
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

function appendOrUpdateSurface(surfaces: readonly AppSurface[], surface: SurfaceDraft): AppSurface[] {
  const currentSurfaces = normalizeSurfaces(surfaces)
  const existing = currentSurfaces.find(item => item.id === surface.id)
  if (!existing) {
    return normalizeSurfaces([
      ...currentSurfaces,
      {
        ...surface,
        order: currentSurfaces.length,
      },
    ])
  }

  return normalizeSurfaces(currentSurfaces.map(item => item.id === surface.id
    ? {
        ...item,
        kind: surface.kind,
        title: item.title || surface.title,
        route: surface.route,
        closable: surface.closable,
      }
    : item))
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
  const next = orderedNext[Math.min(Math.max(closedIndex, 0), orderedNext.length - 1)]
    ?? orderedNext.at(-1)
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

      syncSurface: surface => set(state => ({
        surfaces: appendOrUpdateSurface(state.surfaces, surface),
        activeSurfaceId: surface.id,
      })),

      setActiveSurfaceId: surfaceId => set(state => ({
        activeSurfaceId: state.surfaces.some(surface => surface.id === surfaceId)
          ? surfaceId
          : state.activeSurfaceId,
      })),

      closeSurface: surfaceId => set((state) => {
        const target = state.surfaces.find(surface => surface.id === surfaceId)
        if (!target || !target.closable) {
          return state
        }

        const nextSurfaces = normalizeSurfaces(state.surfaces.filter(surface => surface.id !== surfaceId))
        return {
          surfaces: nextSurfaces,
          activeSurfaceId: readFallbackSurfaceId(state.surfaces, nextSurfaces, surfaceId, state.activeSurfaceId),
        }
      }),

      reorderSurfaces: orderedIds => set((state) => {
        const rank = new Map(orderedIds.map((id, index) => [id, index]))
        return {
          surfaces: normalizeSurfaces([...state.surfaces].sort((left, right) => {
            const leftRank = rank.get(left.id) ?? Number.MAX_SAFE_INTEGER
            const rightRank = rank.get(right.id) ?? Number.MAX_SAFE_INTEGER
            return leftRank - rightRank || left.order - right.order
          })),
        }
      }),

      updateSurfaceTitle: (surfaceId, title) => set(state => ({
        surfaces: state.surfaces.map(surface => surface.id === surfaceId && title
          ? { ...surface, title }
          : surface),
      })),

      resetSurfaces: () => set({
        surfaces: [HOME_SURFACE],
        activeSurfaceId: HOME_SURFACE_ID,
      }),
    }),
    {
      name: SURFACE_STORAGE_KEY,
      storage: createJSONStorage(() => isTearoffWindow ? sessionStorage : localStorage),
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
        if (!state.activeSurfaceId || !state.surfaces.some(surface => surface.id === state.activeSurfaceId)) {
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
