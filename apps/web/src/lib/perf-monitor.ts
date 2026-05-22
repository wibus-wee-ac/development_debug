import { onCLS, onINP, onLCP, onTTFB } from 'web-vitals'

declare global {
  interface Performance {
    memory?: {
      usedJSHeapSize: number
      totalJSHeapSize: number
      jsHeapSizeLimit: number
    }
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

const BUFFER_CAP = 200
const SAMPLE_INTERVAL_MS = 30_000
const LEAK_THRESHOLD = 10

const snapshots: MemorySnapshot[] = []
const vitals: VitalEntry[] = []
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

function sampleMemory() {
  if (!hasPerformanceMemory(performance)) {
    return
  }
  const mem = performance.memory
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
  } else {
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

export function initPerfMonitor() {
  if (intervalId !== null) {
    return
  }

  sampleMemory()
  intervalId = setInterval(sampleMemory, SAMPLE_INTERVAL_MS)
  collectWebVitals()
}
