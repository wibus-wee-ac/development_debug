import {
  updateChatRuntimeMetrics,
  updateChronicleMetrics,
  updateDesktopMetrics,
  updateObservabilityMetrics,
  updateProviderRuntimeMetrics,
  updatePtyMetrics,
  updateServerProcessMetrics,
} from '../../telemetry/metrics'
import * as ChatRuntime from '../chat-runtime/service'
import { getDaemonResources } from '../chronicle/daemon-manager'
import * as Health from '../health/service'
import * as Pty from '../pty/service'
import { providerRuntimeHostManager } from '../provider-runtime/host-manager'
import { getDesktopRuntimeSamples, getQueueHealth } from './service'

function toMB(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100
}

function incrementBucket(buckets: Record<string, number>, key: string, amount = 1): void {
  buckets[key] = (buckets[key] ?? 0) + amount
}

function readActiveResourceCount(name: '_getActiveHandles' | '_getActiveRequests'): number {
  const reader = (process as unknown as Record<string, unknown>)[name]
  if (typeof reader !== 'function') {
    return 0
  }
  try {
    const value = reader()
    return Array.isArray(value) ? value.length : 0
  }
  catch {
    return 0
  }
}

function readRecordNumber(record: Record<string, unknown> | undefined, key: string): number | null {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readNestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key]
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function toBytesFromKiB(value: number | null): number | null {
  return value === null ? null : value * 1024
}

export async function getRuntimeSnapshot() {
  const health = Health.check()
  const memory = process.memoryUsage()
  const activeRuns = ChatRuntime.listActiveRunSummaries()
  const replayBuffers = activeRuns
    .map(run => ChatRuntime.getActiveRunReplayBufferSummary(run.runId))
    .filter(item => item !== null)
  const providerHosts = providerRuntimeHostManager.listHosts()
  const pty = await Pty.listResources()
  const chronicle = getDaemonResources()
  const observability = getQueueHealth()
  const desktop = {
    latestSamples: getDesktopRuntimeSamples(),
  }

  const activeRunsByRuntimeKind: Record<string, number> = {}
  const replayBufferChunksByRuntimeKind: Record<string, number> = {}
  const replayTextDeltasByRuntimeKind: Record<string, number> = {}
  const replayReasoningDeltasByRuntimeKind: Record<string, number> = {}
  const replayToolDeltasByRuntimeKind: Record<string, number> = {}
  for (const run of activeRuns) {
    const runtimeKind = run.providerTargetKind ?? 'unknown'
    incrementBucket(activeRunsByRuntimeKind, runtimeKind)
    const replay = replayBuffers.find(item => item.runId === run.runId)
    if (replay) {
      incrementBucket(replayBufferChunksByRuntimeKind, runtimeKind, replay.chunkCount)
      incrementBucket(replayTextDeltasByRuntimeKind, runtimeKind, replay.textDeltaCount)
      incrementBucket(replayReasoningDeltasByRuntimeKind, runtimeKind, replay.reasoningDeltaCount)
      incrementBucket(replayToolDeltasByRuntimeKind, runtimeKind, replay.toolInputDeltaCount + replay.toolOutputCount)
    }
  }

  const hostsByRuntimeKind: Record<string, number> = {}
  const resourceHostsByRuntimeKind: Record<string, number> = {}
  const refCountsByRuntimeKind: Record<string, number> = {}
  const pinnedCountsByRuntimeKind: Record<string, number> = {}
  for (const host of providerHosts) {
    incrementBucket(hostsByRuntimeKind, host.runtimeKind)
    if (host.hasResource) {
      incrementBucket(resourceHostsByRuntimeKind, host.runtimeKind)
    }
    incrementBucket(refCountsByRuntimeKind, host.runtimeKind, host.refCount)
    incrementBucket(pinnedCountsByRuntimeKind, host.runtimeKind, host.pinnedCount)
  }

  const serverMemory = {
    rssMB: toMB(memory.rss),
    heapUsedMB: toMB(memory.heapUsed),
    heapTotalMB: toMB(memory.heapTotal),
    externalMB: toMB(memory.external),
    arrayBuffersMB: toMB(memory.arrayBuffers),
  }
  const activeHandles = readActiveResourceCount('_getActiveHandles')
  const activeRequests = readActiveResourceCount('_getActiveRequests')

  const terminalCountByRole: Record<string, number> = {}
  const descendantCountByRole: Record<string, number> = {}
  for (const terminal of pty.terminals) {
    incrementBucket(terminalCountByRole, terminal.role)
    incrementBucket(descendantCountByRole, terminal.role, terminal.descendantCount ?? 0)
  }

  const latestDesktopSample = desktop.latestSamples.at(-1)
  const appProcessCountByType: Record<string, number> = {}
  const appProcessMemoryBytesByType: Record<string, number> = {}
  for (const metric of latestDesktopSample?.appMetrics ?? []) {
    const type = typeof metric.type === 'string' && metric.type.length > 0 ? metric.type : 'unknown'
    incrementBucket(appProcessCountByType, type)
    const memory = readNestedRecord(metric, 'memory')
    const workingSetBytes = toBytesFromKiB(readRecordNumber(memory, 'workingSetSize'))
    if (workingSetBytes !== null) {
      incrementBucket(appProcessMemoryBytesByType, type, workingSetBytes)
    }
  }
  const mainMemory = readNestedRecord(latestDesktopSample?.main ?? {}, 'memory')
  const mainMemoryBytesByKind: Record<string, number> = {}
  for (const key of ['workingSetSize', 'peakWorkingSetSize', 'privateBytes', 'sharedBytes']) {
    const bytes = toBytesFromKiB(readRecordNumber(mainMemory, key))
    if (bytes !== null) {
      mainMemoryBytesByKind[key] = bytes
    }
  }

  updateServerProcessMetrics({
    ...serverMemory,
    cpuPercent: health.cpu.percent,
    uptimeSeconds: health.uptime,
    activeHandles,
    activeRequests,
  })
  updateChatRuntimeMetrics({
    activeRunsByRuntimeKind,
    replayBufferChunksByRuntimeKind,
    replayTextDeltasByRuntimeKind,
    replayReasoningDeltasByRuntimeKind,
    replayToolDeltasByRuntimeKind,
  })
  updateProviderRuntimeMetrics({
    hostsByRuntimeKind,
    resourceHostsByRuntimeKind,
    refCountsByRuntimeKind,
    pinnedCountsByRuntimeKind,
  })
  updatePtyMetrics({
    terminalCountByRole,
    rssMBByRole: {
      'cli-tui': pty.totals.cliTuiRssMB,
      'bottom-panel': pty.totals.bottomPanelRssMB,
    },
    cpuPercentByRole: {
      'cli-tui': pty.totals.cliTuiCpuPercent,
      'bottom-panel': pty.totals.bottomPanelCpuPercent,
    },
    descendantCountByRole,
  })
  updateChronicleMetrics(chronicle)
  updateDesktopMetrics({
    latestSampleAgeMs: latestDesktopSample ? Date.now() - latestDesktopSample.sampledAt : null,
    windowCount: latestDesktopSample?.windows.length ?? 0,
    appProcessCountByType,
    appProcessMemoryBytesByType,
    mainMemoryBytesByKind,
  })
  updateObservabilityMetrics(observability)

  return {
    timestamp: Date.now(),
    server: {
      pid: process.pid,
      uptimeSeconds: health.uptime,
      memory: serverMemory,
      cpu: health.cpu,
      node: {
        activeHandles,
        activeRequests,
      },
    },
    chatRuntime: {
      activeRuns,
      replayBuffers,
    },
    providerRuntime: {
      hosts: providerHosts,
    },
    pty,
    chronicle,
    desktop,
    observability,
  }
}
