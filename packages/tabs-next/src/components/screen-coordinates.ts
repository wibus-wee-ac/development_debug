export interface ScreenCoordinates {
  screenX: number
  screenY: number
}

export function getEventScreenCoordinates(event: Event | null): ScreenCoordinates | null {
  if (!event) {
    return null
  }

  const pointerLike = event as Event & Partial<ScreenCoordinates>
  if (typeof pointerLike.screenX === 'number' && typeof pointerLike.screenY === 'number') {
    return { screenX: pointerLike.screenX, screenY: pointerLike.screenY }
  }

  const touchLike = event as Event & {
    touches?: ArrayLike<ScreenCoordinates>
    changedTouches?: ArrayLike<ScreenCoordinates>
  }
  const touch = touchLike.changedTouches?.[0] ?? touchLike.touches?.[0]
  if (touch && typeof touch.screenX === 'number' && typeof touch.screenY === 'number') {
    return { screenX: touch.screenX, screenY: touch.screenY }
  }

  return null
}

export function isPointerOutsideWindow(
  pointer: ScreenCoordinates | null,
  windowBounds: Pick<Window, 'screenX' | 'screenY' | 'outerWidth' | 'outerHeight'>,
): boolean {
  if (!pointer) {
    return false
  }

  return (
    pointer.screenX < windowBounds.screenX
    || pointer.screenX > windowBounds.screenX + windowBounds.outerWidth
    || pointer.screenY < windowBounds.screenY
    || pointer.screenY > windowBounds.screenY + windowBounds.outerHeight
  )
}
