import { deleteTerminalSessionsShellByPtyId } from '~/api-gen/sdk.gen'
import { stopTerminalPanelOwners } from '~/features/tui/terminal-panel-cleanup'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'

import type { AppSurface } from './surface-identity'
import { useSurfaceStore } from './surface-store'

type TerminalPanelStopper = (ownerIds: string[]) => void
type BrowserPanelOwnerReleaser = (ownerIds: string[]) => void

function readTerminalPanelOwnerId(surface: Pick<AppSurface, 'kind' | 'route'>): string | null {
  if (surface.kind === 'chat' && surface.route.to === '/chat/$sessionId') {
    return `chat:${surface.route.params.sessionId}`
  }

  if (surface.kind === 'workspace' && surface.route.to === '/workspaces/$workspaceId') {
    return `workspace:${surface.route.params.workspaceId}`
  }

  return null
}

export function selectTerminalPanelOwnerIds(surfaces: readonly Pick<AppSurface, 'kind' | 'route'>[]): Set<string> {
  const ownerIds = new Set<string>()

  for (const surface of surfaces) {
    const ownerId = readTerminalPanelOwnerId(surface)
    if (ownerId) {
      ownerIds.add(ownerId)
    }
  }

  return ownerIds
}

export function selectClosedTerminalPanelOwnerIds(
  previousSurfaces: readonly Pick<AppSurface, 'kind' | 'route'>[],
  nextSurfaces: readonly Pick<AppSurface, 'kind' | 'route'>[],
): string[] {
  const previousOwnerIds = selectTerminalPanelOwnerIds(previousSurfaces)
  const nextOwnerIds = selectTerminalPanelOwnerIds(nextSurfaces)

  return Array.from(previousOwnerIds).filter(ownerId => !nextOwnerIds.has(ownerId))
}

export function selectClosedBrowserPanelOwnerIds(
  previousSurfaces: readonly Pick<AppSurface, 'id'>[],
  nextSurfaces: readonly Pick<AppSurface, 'id'>[],
): string[] {
  const nextOwnerIds = new Set(nextSurfaces.map(surface => surface.id))
  return previousSurfaces
    .map(surface => surface.id)
    .filter(ownerId => !nextOwnerIds.has(ownerId))
}

function releaseBrowserPanelOwners(ownerIds: string[]): void {
  const browserStore = useBrowserPanelStore.getState()
  const layoutStore = useLayoutStore.getState()
  const browserBridge = window.cradle?.browser

  for (const ownerId of ownerIds) {
    layoutStore.setBrowserPanelOpen(false, ownerId)
    for (const tab of browserStore.owners[ownerId]?.tabs ?? []) {
      if (tab.kind === 'tui') {
        void deleteTerminalSessionsShellByPtyId({
          path: { ptyId: tab.ptyId },
        }).catch(() => {})
      }
    }
    browserStore.removeOwnerState(ownerId)
    void browserBridge?.close({ threadId: ownerId }).catch(() => {})
  }
}

export function releaseSurfaceResources(
  previousSurfaces: readonly AppSurface[],
  nextSurfaces: readonly AppSurface[],
  stopOwners: TerminalPanelStopper = stopTerminalPanelOwners,
  releaseBrowserOwners: BrowserPanelOwnerReleaser = releaseBrowserPanelOwners,
): void {
  const closedTerminalOwnerIds = selectClosedTerminalPanelOwnerIds(previousSurfaces, nextSurfaces)
  if (closedTerminalOwnerIds.length > 0) {
    stopOwners(closedTerminalOwnerIds)
  }

  const closedBrowserOwnerIds = selectClosedBrowserPanelOwnerIds(previousSurfaces, nextSurfaces)
  if (closedBrowserOwnerIds.length > 0) {
    releaseBrowserOwners(closedBrowserOwnerIds)
  }
}

export function installSurfaceResourceLifecycle(): () => void {
  return useSurfaceStore.subscribe((state, previousState) => {
    if (state.surfaces === previousState.surfaces) {
      return
    }
    releaseSurfaceResources(previousState.surfaces, state.surfaces)
  })
}
