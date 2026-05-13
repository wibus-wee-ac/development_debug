import type { Static } from 'elysia'

import type { HealthModel } from './model'

function toMB(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100
}

export function check(): Static<typeof HealthModel['checkResponse']> {
  const mem = process.memoryUsage()
  return {
    status: 'ok',
    uptime: Math.round(process.uptime()),
    memory: {
      heapUsed: toMB(mem.heapUsed),
      heapTotal: toMB(mem.heapTotal),
      rss: toMB(mem.rss),
      external: toMB(mem.external),
    },
    timestamp: Date.now(),
  }
}
