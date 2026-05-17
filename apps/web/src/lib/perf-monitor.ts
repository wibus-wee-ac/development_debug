import { onCLS, onINP, onLCP, onTTFB } from 'web-vitals'

interface MemorySnapshot {
  timestamp: number
  heapUsed: number
  heapTotal: number
  heapLimit: number
}

interface VitalEntry {
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

function hasPerformanceMemory(): boolean {
  return typeof performance !== 'undefined' && 'memory' in performance
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
  if (!hasPerformanceMemory()) {
    return
  }
  const mem = (performance as any).memory
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

  ;(window as any).__CRADLE_PERF__ = {
    getSnapshots: getPerfSnapshots,
    getVitals: getWebVitals,
  }
}
