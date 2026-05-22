import type { Static } from 'elysia'

import type { HealthModel } from './model'

function toMB(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100
}

let previousCpuSample: { usageMicros: number, sampledAt: number } | null = null

function readCpuSnapshot(): Static<typeof HealthModel['checkResponse']>['cpu'] {
  const usage = process.cpuUsage()
  const usageMicros = usage.user + usage.system
  const sampledAt = Date.now()
  const previous = previousCpuSample
  previousCpuSample = { usageMicros, sampledAt }

  if (!previous || sampledAt <= previous.sampledAt) {
    return {
      percent: null,
      userMicros: usage.user,
      systemMicros: usage.system,
    }
  }

  const elapsedMicros = (sampledAt - previous.sampledAt) * 1000
  const usedMicros = Math.max(0, usageMicros - previous.usageMicros)
  return {
    percent: Math.round((usedMicros / elapsedMicros) * 10000) / 100,
    userMicros: usage.user,
    systemMicros: usage.system,
  }
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
    cpu: readCpuSnapshot(),
    timestamp: Date.now(),
  }
}
