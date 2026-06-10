import { isElectron, isTearoffWindow, nativeIpc, subscribeTearoffSessionClosed } from '~/lib/electron'

import { closeSurfaceById, openChatSession } from './navigation-commands'
import { chatSurfaceId } from './surface-identity'

const activeTearoffSessions = new Set<string>()

export function reserveTearoffSession(sessionId: string): boolean {
  if (activeTearoffSessions.has(sessionId)) {
    return false
  }
  activeTearoffSessions.add(sessionId)
  return true
}

export function releaseTearoffSession(sessionId: string): void {
  activeTearoffSessions.delete(sessionId)
}

export async function openTearoffSessionWindow(
  sessionId: string,
  options: {
    screenX?: number
    screenY?: number
    detachSurface?: boolean
  } = {},
): Promise<boolean> {
  if (!isElectron || !nativeIpc) {
    return false
  }

  const screenX = options.screenX ?? window.screenX + Math.round(window.outerWidth / 2)
  const screenY = options.screenY ?? window.screenY + Math.round(window.outerHeight / 2)
  if (!reserveTearoffSession(sessionId)) {
    return true
  }

  try {
    await nativeIpc.window.tearOffSession(sessionId, screenX, screenY)
    if (options.detachSurface && !isTearoffWindow) {
      closeSurfaceById(chatSurfaceId(sessionId))
    }
    return true
  }
  catch {
    releaseTearoffSession(sessionId)
    return false
  }
}

export function installTearoffSessionRestore(): () => void {
  return subscribeTearoffSessionClosed((sessionId) => {
    releaseTearoffSession(sessionId)
    openChatSession(sessionId)
  })
}
