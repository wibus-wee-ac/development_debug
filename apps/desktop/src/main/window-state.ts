import { readFileSync } from 'node:fs'

import { z } from 'zod'

export interface WindowBounds {
  x?: number
  y?: number
  width?: number
  height?: number
}

export interface DisplayWorkArea {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowBoundsPolicy {
  defaultWidth: number
  defaultHeight: number
  minWidth: number
  minHeight: number
}

const StoredWindowBoundsJsonSchema = z.preprocess(
  raw => JSON.parse(raw as string),
  z.object({
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    width: z.number().finite().positive().optional(),
    height: z.number().finite().positive().optional(),
  }),
)

export function readStoredWindowBounds(filePath: string): WindowBounds | null {
  try {
    return StoredWindowBoundsJsonSchema.parse(readFileSync(filePath, 'utf8'))
  }
  catch {
    return null
  }
}

export function resolveVisibleWindowBounds(
  storedBounds: WindowBounds,
  workAreas: DisplayWorkArea[],
  policy: WindowBoundsPolicy,
  primaryWorkArea = workAreas[0],
): Required<WindowBounds> {
  const validWorkAreas = workAreas.filter(isUsableWorkArea)
  const fallbackWorkArea = isUsableWorkArea(primaryWorkArea) ? primaryWorkArea : validWorkAreas[0]

  if (!fallbackWorkArea) {
    return {
      x: 0,
      y: 0,
      width: readDimension(storedBounds.width, policy.defaultWidth, policy.minWidth),
      height: readDimension(storedBounds.height, policy.defaultHeight, policy.minHeight),
    }
  }

  const storedWorkArea = pickWorkAreaForBounds(storedBounds, validWorkAreas)
  const targetWorkArea = storedWorkArea ?? fallbackWorkArea
  const width = readDimension(storedBounds.width, policy.defaultWidth, policy.minWidth, targetWorkArea.width)
  const height = readDimension(storedBounds.height, policy.defaultHeight, policy.minHeight, targetWorkArea.height)
  const centeredX = targetWorkArea.x + Math.round((targetWorkArea.width - width) / 2)
  const centeredY = targetWorkArea.y + Math.round((targetWorkArea.height - height) / 2)
  const targetX = storedWorkArea && isFiniteNumber(storedBounds.x) ? Math.round(storedBounds.x) : centeredX
  const targetY = storedWorkArea && isFiniteNumber(storedBounds.y) ? Math.round(storedBounds.y) : centeredY

  return {
    x: clampPosition(targetX, targetWorkArea.x, targetWorkArea.x + targetWorkArea.width - width),
    y: clampPosition(targetY, targetWorkArea.y, targetWorkArea.y + targetWorkArea.height - height),
    width,
    height,
  }
}

function pickWorkAreaForBounds(bounds: WindowBounds, workAreas: DisplayWorkArea[]): DisplayWorkArea | undefined {
  if (
    !isFiniteNumber(bounds.x)
    || !isFiniteNumber(bounds.y)
    || !isFiniteNumber(bounds.width)
    || !isFiniteNumber(bounds.height)
  ) {
    return undefined
  }

  const measuredBounds = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  }
  let selectedWorkArea: DisplayWorkArea | undefined
  let selectedArea = 0

  for (const workArea of workAreas) {
    const visibleArea = getIntersectionArea(measuredBounds, workArea)
    if (visibleArea > selectedArea) {
      selectedArea = visibleArea
      selectedWorkArea = workArea
    }
  }

  return selectedArea > 0 ? selectedWorkArea : undefined
}

function getIntersectionArea(bounds: Required<WindowBounds>, workArea: DisplayWorkArea): number {
  const left = Math.max(bounds.x, workArea.x)
  const right = Math.min(bounds.x + bounds.width, workArea.x + workArea.width)
  const top = Math.max(bounds.y, workArea.y)
  const bottom = Math.min(bounds.y + bounds.height, workArea.y + workArea.height)
  const width = Math.max(0, right - left)
  const height = Math.max(0, bottom - top)

  return width * height
}

function readDimension(value: number | undefined, fallback: number, minimum: number, maximum = Number.POSITIVE_INFINITY): number {
  const base = isFiniteNumber(value) && value > 0 ? Math.round(value) : fallback
  const limitedMaximum = Number.isFinite(maximum) && maximum > 0 ? Math.round(maximum) : Number.POSITIVE_INFINITY
  const limitedMinimum = Number.isFinite(limitedMaximum) ? Math.min(minimum, limitedMaximum) : minimum

  return Math.min(Math.max(base, limitedMinimum), limitedMaximum)
}

function clampPosition(value: number, minimum: number, maximum: number): number {
  if (maximum < minimum) {
    return minimum
  }

  return Math.min(Math.max(value, minimum), maximum)
}

function isUsableWorkArea(value: DisplayWorkArea | undefined): value is DisplayWorkArea {
  return Boolean(value && Number.isFinite(value.x) && Number.isFinite(value.y) && value.width > 0 && value.height > 0)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
