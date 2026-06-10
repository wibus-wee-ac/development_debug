export type SurfaceKind =
  | 'home'
  | 'new-chat'
  | 'chat'
  | 'workspace'
  | 'kanban'
  | 'plugin'
  | 'awaits'
  | 'automation'
  | 'usage'
  | 'settings'
  | 'onboarding'
  | 'devtool'

export type SurfaceRoute =
  | { to: '/', params?: undefined, search?: undefined }
  | { to: '/chat/new', params?: undefined, search?: undefined }
  | { to: '/chat/$sessionId', params: { sessionId: string }, search?: undefined }
  | { to: '/workspaces/$workspaceId', params: { workspaceId: string }, search?: undefined }
  | { to: '/kanban/$boardId', params: { boardId: string }, search?: { issue?: string, milestoneId?: string } }
  | { to: '/plugins/$routeSegment/$localId', params: { routeSegment: string, localId: string }, search?: undefined }
  | { to: '/awaits', params?: undefined, search?: undefined }
  | { to: '/automation', params?: undefined, search?: undefined }
  | { to: '/usage', params?: undefined, search?: undefined }
  | { to: '/settings/$section', params: { section: string }, search?: undefined }
  | { to: '/onboarding', params?: undefined, search?: undefined }
  | { to: '/devtool', params?: undefined, search?: undefined }

export interface AppSurface {
  id: string
  kind: SurfaceKind
  title: string
  route: SurfaceRoute
  order: number
  closable: boolean
}

export interface SurfaceDraft {
  id: string
  kind: SurfaceKind
  title: string
  route: SurfaceRoute
  closable: boolean
}

export const HOME_SURFACE_ID = 'home'

export const HOME_SURFACE: AppSurface = {
  id: HOME_SURFACE_ID,
  kind: 'home',
  title: '首页',
  route: { to: '/' },
  order: 0,
  closable: false,
}

export function createHomeSurfaceDraft(): SurfaceDraft {
  return {
    id: HOME_SURFACE.id,
    kind: HOME_SURFACE.kind,
    title: HOME_SURFACE.title,
    route: HOME_SURFACE.route,
    closable: HOME_SURFACE.closable,
  }
}

export function chatSurfaceId(sessionId: string): string {
  return `chat:${sessionId}`
}

export function workspaceSurfaceId(workspaceId: string): string {
  return `workspace:${workspaceId}`
}

export function kanbanSurfaceId(boardId: string): string {
  return `kanban:${boardId}`
}

export function pluginSurfaceId(routeSegment: string, localId: string): string {
  return `plugin:${routeSegment}:${localId}`
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function surfaceDraftFromRoute(input: {
  pathname: string
  params?: Record<string, unknown>
  search?: Record<string, unknown>
}): SurfaceDraft | null {
  const params = input.params ?? {}
  const search = input.search ?? {}

  if (input.pathname === '/' || input.pathname === '/home') {
    return createHomeSurfaceDraft()
  }

  if (input.pathname === '/chat/new') {
    return {
      id: 'new-chat',
      kind: 'new-chat',
      title: '新建聊天',
      route: { to: '/chat/new' },
      closable: true,
    }
  }

  const sessionId = readString(params.sessionId)
  if (input.pathname.startsWith('/chat/') && sessionId) {
    return {
      id: chatSurfaceId(sessionId),
      kind: 'chat',
      title: 'Chat',
      route: { to: '/chat/$sessionId', params: { sessionId } },
      closable: true,
    }
  }

  const workspaceId = readString(params.workspaceId)
  if (input.pathname.startsWith('/workspaces/') && workspaceId) {
    return {
      id: workspaceSurfaceId(workspaceId),
      kind: 'workspace',
      title: 'Workspace',
      route: { to: '/workspaces/$workspaceId', params: { workspaceId } },
      closable: true,
    }
  }

  const boardId = readString(params.boardId)
  if (input.pathname.startsWith('/kanban/') && boardId) {
    return {
      id: kanbanSurfaceId(boardId),
      kind: 'kanban',
      title: '看板',
      route: {
        to: '/kanban/$boardId',
        params: { boardId },
        search: {
          issue: readString(search.issue),
          milestoneId: readString(search.milestoneId),
        },
      },
      closable: true,
    }
  }

  const routeSegment = readString(params.routeSegment)
  const localId = readString(params.localId)
  if (input.pathname.startsWith('/plugins/') && routeSegment && localId) {
    return {
      id: pluginSurfaceId(routeSegment, localId),
      kind: 'plugin',
      title: 'Plugin',
      route: { to: '/plugins/$routeSegment/$localId', params: { routeSegment, localId } },
      closable: true,
    }
  }

  if (input.pathname === '/awaits') {
    return {
      id: 'awaits',
      kind: 'awaits',
      title: 'Awaits',
      route: { to: '/awaits' },
      closable: true,
    }
  }

  if (input.pathname === '/automation') {
    return {
      id: 'automation',
      kind: 'automation',
      title: 'Automations',
      route: { to: '/automation' },
      closable: true,
    }
  }

  if (input.pathname === '/usage') {
    return {
      id: 'usage',
      kind: 'usage',
      title: '用量',
      route: { to: '/usage' },
      closable: true,
    }
  }

  const section = readString(params.section) ?? 'appearance'
  if (input.pathname.startsWith('/settings/')) {
    return {
      id: 'settings',
      kind: 'settings',
      title: 'Settings',
      route: { to: '/settings/$section', params: { section } },
      closable: true,
    }
  }

  if (input.pathname === '/onboarding') {
    return {
      id: 'onboarding',
      kind: 'onboarding',
      title: 'Onboarding',
      route: { to: '/onboarding' },
      closable: true,
    }
  }

  if (input.pathname === '/devtool') {
    return {
      id: 'devtool',
      kind: 'devtool',
      title: 'Devtool',
      route: { to: '/devtool' },
      closable: true,
    }
  }

  return null
}

export function layoutSlotIdForSurface(surface: Pick<AppSurface, 'kind' | 'route'> | null | undefined): string | null {
  if (!surface) {
    return null
  }

  if (surface.kind === 'chat' && surface.route.to === '/chat/$sessionId') {
    return surface.route.params.sessionId
  }

  if (surface.kind === 'workspace' && surface.route.to === '/workspaces/$workspaceId') {
    return `workspace-detail:${surface.route.params.workspaceId}`
  }

  if (surface.kind === 'new-chat') {
    return 'new-chat'
  }

  return null
}

export function chatSessionIdForSurface(surface: Pick<AppSurface, 'kind' | 'route'> | null | undefined): string | null {
  if (surface?.kind === 'chat' && surface.route.to === '/chat/$sessionId') {
    return surface.route.params.sessionId
  }

  return null
}

export function workspaceIdForSurface(surface: Pick<AppSurface, 'kind' | 'route'> | null | undefined): string | null {
  if (surface?.kind === 'workspace' && surface.route.to === '/workspaces/$workspaceId') {
    return surface.route.params.workspaceId
  }

  return null
}

export function sortSurfaces(surfaces: readonly AppSurface[]): AppSurface[] {
  return [...surfaces].sort((left, right) => left.order - right.order)
}
