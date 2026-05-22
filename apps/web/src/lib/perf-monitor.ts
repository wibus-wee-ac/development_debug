import { onCLS, onINP, onLCP, onTTFB } from 'web-vitals'
import { z } from 'zod'

import { buildCradlePerfReport } from './perf-report'

interface CradlePerfApi {
  getReport: typeof getCradlePerfReport
  getMarks: typeof getPerformanceMarks
  getMeasures: typeof getPerformanceMeasures
  getSnapshots: typeof getPerfSnapshots
  getVitals: typeof getWebVitals
  mark: typeof markCradlePerformance
  measure: typeof measureCradlePerformance
}

declare global {
  interface Performance {
    memory?: {
      usedJSHeapSize: number
      totalJSHeapSize: number
      jsHeapSizeLimit: number
    }
  }

  interface Window {
    __CRADLE_PERF__?: CradlePerfApi
  }
}

export interface MemorySnapshot {
  timestamp: number
  heapUsed: number
  heapTotal: number
  heapLimit: number
}

export interface VitalEntry {
  name: string
  value: number
  rating: 'good' | 'needs-improvement' | 'poor'
  timestamp: number
}

export interface PerfMarkEntry {
  name: string
  startTime: number
  timestamp: number
}

export interface PerfMeasureEntry {
  name: string
  startMark: string
  endMark: string
  duration: number
  timestamp: number
}

const BUFFER_CAP = 200
const SAMPLE_INTERVAL_MS = 30_000
const LEAK_THRESHOLD = 10

const PerformanceMemorySchema = z.object({
  usedJSHeapSize: z.number(),
  totalJSHeapSize: z.number(),
  jsHeapSizeLimit: z.number(),
})

const snapshots: MemorySnapshot[] = []
const vitals: VitalEntry[] = []
const marks: PerfMarkEntry[] = []
const measures: PerfMeasureEntry[] = []
let intervalId: ReturnType<typeof setInterval> | null = null
let consecutiveIncreases = 0
let lastHeapUsed = 0

function hasPerformanceMemory(perf: Performance): perf is Performance & { memory: NonNullable<Performance['memory']> } {
  return 'memory' in perf
}

function pushSnapshot(buf: MemorySnapshot[], entry: MemorySnapshot) {
  if (buf.length >= BUFFER_CAP) {
    buf.shift()
  }
  buf.push(entry)
}

function pushVital(buf: VitalEntry[], entry: VitalEntry) {
  if (buf.length >= BUFFER_CAP) {
    buf.shift()
  }
  buf.push(entry)
}

function pushMark(entry: PerfMarkEntry) {
  if (marks.length >= BUFFER_CAP) {
    marks.shift()
  }
  marks.push(entry)
}

function pushMeasure(entry: PerfMeasureEntry) {
  if (measures.length >= BUFFER_CAP) {
    measures.shift()
  }
  measures.push(entry)
}

function sampleMemory() {
  if (!hasPerformanceMemory(performance)) {
    return
  }
  const mem = PerformanceMemorySchema.parse(performance.memory)
  const snap: MemorySnapshot = {
    timestamp: Date.now(),
    heapUsed: mem.usedJSHeapSize,
    heapTotal: mem.totalJSHeapSize,
    heapLimit: mem.jsHeapSizeLimit,
  }
  pushSnapshot(snapshots, snap)

  if (snap.heapUsed > lastHeapUsed && lastHeapUsed > 0) {
    consecutiveIncreases++
    if (consecutiveIncreases >= LEAK_THRESHOLD) {
      console.warn('[perf] possible memory leak detected')
    }
  }
 else {
    consecutiveIncreases = 0
  }
  lastHeapUsed = snap.heapUsed
}

function collectWebVitals() {
  const record = (name: string) => (metric: { value: number, rating: 'good' | 'needs-improvement' | 'poor' }) => {
    pushVital(vitals, {
      name,
      value: metric.value,
      rating: metric.rating,
      timestamp: Date.now(),
    })
  }
  onLCP(record('LCP'))
  onCLS(record('CLS'))
  onINP(record('INP'))
  onTTFB(record('TTFB'))
}

export function getPerfSnapshots(): MemorySnapshot[] {
  return [...snapshots]
}

export function getWebVitals(): VitalEntry[] {
  return [...vitals]
}

export function getPerformanceMarks(): PerfMarkEntry[] {
  return [...marks]
}

export function getPerformanceMeasures(): PerfMeasureEntry[] {
  return [...measures]
}

export function markCradlePerformance(name: string): void {
  performance.mark(name)
  const entries = performance.getEntriesByName(name, 'mark')
  const latest = entries.at(-1)!
  pushMark({
    name,
    startTime: latest.startTime,
    timestamp: Date.now(),
  })
}

export function measureCradlePerformance(name: string, startMark: string, endMark: string): void {
  performance.measure(name, startMark, endMark)
  const entries = performance.getEntriesByName(name, 'measure')
  const latest = entries.at(-1)!
  pushMeasure({
    name,
    startMark,
    endMark,
    duration: latest.duration,
    timestamp: Date.now(),
  })
}

export function getCradlePerfReport() {
  return buildCradlePerfReport({
    marks: getPerformanceMarks(),
    measures: getPerformanceMeasures(),
    vitals: getWebVitals(),
    snapshots: getPerfSnapshots(),
  })
}

function _stopPerfMonitor() {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
}

export function initPerfMonitor() {
  if (intervalId !== null) {
    return
  }

  sampleMemory()
  intervalId = setInterval(sampleMemory, SAMPLE_INTERVAL_MS)
  collectWebVitals()

  window.__CRADLE_PERF__ = {
    getReport: getCradlePerfReport,
    getMarks: getPerformanceMarks,
    getMeasures: getPerformanceMeasures,
    getSnapshots: getPerfSnapshots,
    getVitals: getWebVitals,
    mark: markCradlePerformance,
    measure: measureCradlePerformance,
  }
}
