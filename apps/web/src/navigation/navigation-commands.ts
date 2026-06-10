import { router } from '~/router'

import type { AppSurface, SurfaceDraft } from './surface-identity'
import {
  chatSurfaceId,
  createHomeSurfaceDraft,
  kanbanSurfaceId,
  pluginSurfaceId,
  workspaceSurfaceId,
} from './surface-identity'
import { readActiveSurface, readSurface, useSurfaceStore } from './surface-store'

type RouterNavigateOptions = Parameters<typeof router.navigate>[0]

function toRouterNavigateOptions(surface: Pick<AppSurface, 'route'> | SurfaceDraft, replace = false): RouterNavigateOptions {
  return {
    ...surface.route,
    replace,
  } as RouterNavigateOptions
}

export function navigateToSurface(surface: AppSurface, options: { replace?: boolean } = {}): void {
  useSurfaceStore.getState().syncSurface(surface)
  void router.navigate(toRouterNavigateOptions(surface, options.replace))
}

function openSurface(surface: SurfaceDraft, options: { replace?: boolean } = {}): void {
  useSurfaceStore.getState().syncSurface(surface)
  void router.navigate(toRouterNavigateOptions(surface, options.replace))
}

export function openHome(options: { replace?: boolean } = {}): void {
  openSurface(createHomeSurfaceDraft(), options)
}

export function openNewChat(options: { replace?: boolean } = {}): void {
  openSurface({
    id: 'new-chat',
    kind: 'new-chat',
    title: '新建聊天',
    route: { to: '/chat/new' },
    closable: true,
  }, options)
}

export function openChatSession(sessionId: string, options: { replace?: boolean } = {}): void {
  openSurface({
    id: chatSurfaceId(sessionId),
    kind: 'chat',
    title: 'Chat',
    route: { to: '/chat/$sessionId', params: { sessionId } },
    closable: true,
  }, options)
}

export function openWorkspaceDetail(workspaceId: string, options: { replace?: boolean } = {}): void {
  openSurface({
    id: workspaceSurfaceId(workspaceId),
    kind: 'workspace',
    title: 'Workspace',
    route: { to: '/workspaces/$workspaceId', params: { workspaceId } },
    closable: true,
  }, options)
}

export function openKanbanBoard(input: {
  boardId: string
  issueId?: string
  milestoneId?: string
}, options: { replace?: boolean } = {}): void {
  openSurface({
    id: kanbanSurfaceId(input.boardId),
    kind: 'kanban',
    title: '看板',
    route: {
      to: '/kanban/$boardId',
      params: { boardId: input.boardId },
      search: {
        issue: input.issueId,
        milestoneId: input.milestoneId,
      },
    },
    closable: true,
  }, options)
}

export function openPluginPanel(input: {
  routeSegment: string
  localId: string
}, options: { replace?: boolean } = {}): void {
  openSurface({
    id: pluginSurfaceId(input.routeSegment, input.localId),
    kind: 'plugin',
    title: 'Plugin',
    route: {
      to: '/plugins/$routeSegment/$localId',
      params: {
        routeSegment: input.routeSegment,
        localId: input.localId,
      },
    },
    closable: true,
  }, options)
}

export function openSettingsSection(section: string, options: { replace?: boolean } = {}): void {
  openSurface({
    id: 'settings',
    kind: 'settings',
    title: 'Settings',
    route: { to: '/settings/$section', params: { section } },
    closable: true,
  }, options)
}

export function openAwaits(options: { replace?: boolean } = {}): void {
  openSurface({
    id: 'awaits',
    kind: 'awaits',
    title: 'Awaits',
    route: { to: '/awaits' },
    closable: true,
  }, options)
}

export function openAutomation(options: { replace?: boolean } = {}): void {
  openSurface({
    id: 'automation',
    kind: 'automation',
    title: 'Automations',
    route: { to: '/automation' },
    closable: true,
  }, options)
}

export function openUsage(options: { replace?: boolean } = {}): void {
  openSurface({
    id: 'usage',
    kind: 'usage',
    title: '用量',
    route: { to: '/usage' },
    closable: true,
  }, options)
}

export function closeSurfaceById(surfaceId: string): void {
  const previousActiveSurfaceId = useSurfaceStore.getState().activeSurfaceId
  useSurfaceStore.getState().closeSurface(surfaceId)

  if (previousActiveSurfaceId !== surfaceId) {
    return
  }

  navigateToSurface(readActiveSurface(), { replace: true })
}

export function closeActiveSurface(): void {
  const activeSurfaceId = useSurfaceStore.getState().activeSurfaceId
  if (!activeSurfaceId) {
    return
  }
  closeSurfaceById(activeSurfaceId)
}

export function activateSurface(surfaceId: string): void {
  const surface = readSurface(surfaceId)
  if (!surface) {
    return
  }
  navigateToSurface(surface)
}

export function activateAdjacentSurface(direction: 1 | -1): void {
  const state = useSurfaceStore.getState()
  const surfaces = [...state.surfaces].sort((left, right) => left.order - right.order)
  if (surfaces.length <= 1) {
    return
  }

  const currentIndex = Math.max(0, surfaces.findIndex(surface => surface.id === state.activeSurfaceId))
  const nextIndex = (currentIndex + direction + surfaces.length) % surfaces.length
  activateSurface(surfaces[nextIndex]!.id)
}
