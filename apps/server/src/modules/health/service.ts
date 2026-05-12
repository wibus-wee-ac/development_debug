import type { Static } from 'elysia'

import type { HealthModel } from './model'

export function check(): Static<typeof HealthModel['checkResponse']> {
  return { status: 'ok', timestamp: Date.now() }
}
