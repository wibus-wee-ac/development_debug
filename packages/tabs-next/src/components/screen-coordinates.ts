export interface ScreenCoordinates {
  screenX: number
  screenY: number
}

interface ClientCoordinates {
  clientX: number
  clientY: number
}

export function getEventScreenCoordinates(
  event: Event | null,
  windowBounds?: Pick<Window, 'screenX' | 'screenY'>,
): ScreenCoordinates | null {
  if (!event) {
    return null
  }

  const pointerLike = event as Event & Partial<ScreenCoordinates & ClientCoordinates>
  if (typeof pointerLike.screenX === 'number' && typeof pointerLike.screenY === 'number') {
    if (
      pointerLike.screenX === 0
      && pointerLike.screenY === 0
      && windowBounds
      && typeof pointerLike.clientX === 'number'
      && typeof pointerLike.clientY === 'number'
    ) {
      return {
        screenX: windowBounds.screenX + pointerLike.clientX,
        screenY: windowBounds.screenY + pointerLike.clientY,
      }
    }

    return { screenX: pointerLike.screenX, screenY: pointerLike.screenY }
  }

  const touchLike = event as Event & {
    touches?: ArrayLike<ScreenCoordinates & Partial<ClientCoordinates>>
    changedTouches?: ArrayLike<ScreenCoordinates & Partial<ClientCoordinates>>
  }
  const touch = touchLike.changedTouches?.[0] ?? touchLike.touches?.[0]
  if (touch && typeof touch.screenX === 'number' && typeof touch.screenY === 'number') {
    if (
      touch.screenX === 0
      && touch.screenY === 0
      && windowBounds
      && typeof touch.clientX === 'number'
      && typeof touch.clientY === 'number'
    ) {
      return {
        screenX: windowBounds.screenX + touch.clientX,
        screenY: windowBounds.screenY + touch.clientY,
      }
    }

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

