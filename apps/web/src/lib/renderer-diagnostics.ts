import { getChatStoreTelemetrySnapshot } from '~/store/chat'

import { getPerfSnapshots, getWebVitals } from './perf-monitor'

declare global {
  interface Window {
    __CRADLE_RENDERER_DIAGNOSTICS__?: () => Record<string, unknown>
  }
}

function readPerformanceMemory(): Record<string, number> | null {
  const memory = (performance as Performance & {
    memory?: {
      usedJSHeapSize?: number
      totalJSHeapSize?: number
      jsHeapSizeLimit?: number
    }
  }).memory
  if (!memory) {
    return null
  }
  return {
    usedJSHeapSize: memory.usedJSHeapSize ?? 0,
    totalJSHeapSize: memory.totalJSHeapSize ?? 0,
    jsHeapSizeLimit: memory.jsHeapSizeLimit ?? 0,
  }
}

export function readRendererDiagnostics(): Record<string, unknown> {
  return {
    sampledAt: Date.now(),
    location: {
      href: window.location.href,
      hash: window.location.hash,
      pathname: window.location.pathname,
    },
    electron: {
      isElectron: window.cradle?.env?.isElectron === true,
      isTearoff: window.cradle?.env?.isTearoff === true,
      sessionId: window.cradle?.env?.sessionId ?? null,
      surface: window.cradle?.env?.surface ?? null,
    },
    rendererMemory: {
      current: readPerformanceMemory(),
      recentSamples: getPerfSnapshots().slice(-20),
      webVitals: getWebVitals().slice(-20),
    },
    chatStore: getChatStoreTelemetrySnapshot(),
  }
}

export function installRendererDiagnostics(): void {
  window.__CRADLE_RENDERER_DIAGNOSTICS__ = readRendererDiagnostics
}
