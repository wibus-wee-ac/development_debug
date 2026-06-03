import { app } from 'electron'

interface DesktopObservabilityEvent {
  source: 'desktop-main'
  code: string
  severity: 'error' | 'fatal'
  category: 'system'
  message: string
  attrs: Record<string, unknown>
  occurredAt: number
}

let serverUrl: string | null = null
const pendingEvents: DesktopObservabilityEvent[] = []

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }
  return { value: String(error) }
}

function createEvent(code: string, message: string, error: unknown): DesktopObservabilityEvent {
  return {
    source: 'desktop-main',
    code,
    severity: 'fatal',
    category: 'system',
    message,
    attrs: {
      error: serializeError(error),
      desktop: {
        appVersion: app.getVersion(),
        isPackaged: app.isPackaged,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
      },
    },
    occurredAt: Date.now(),
  }
}

async function sendEvent(event: DesktopObservabilityEvent): Promise<void> {
  if (!serverUrl) {
    pendingEvents.push(event)
    return
  }
  await fetch(new URL('/observability/events', serverUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  })
}

function reportEvent(event: DesktopObservabilityEvent): void {
  void sendEvent(event).catch(() => {
    pendingEvents.push(event)
  })
}

export function bindDesktopObservabilityServerUrl(url: string): void {
  serverUrl = url
  const events = pendingEvents.splice(0)
  for (const event of events) {
    void sendEvent(event).catch(() => {
      pendingEvents.push(event)
    })
  }
}

export function installDesktopMainErrorCapture(): void {
  process.on('uncaughtException', (error) => {
    console.error('[desktop] uncaught exception:', error)
    reportEvent(createEvent('DESKTOP_MAIN_UNCAUGHT_EXCEPTION', 'Desktop main uncaught exception', error))
  })

  process.on('unhandledRejection', (reason) => {
    console.error('[desktop] unhandled rejection:', reason)
    reportEvent(createEvent('DESKTOP_MAIN_UNHANDLED_REJECTION', 'Desktop main unhandled promise rejection', reason))
  })
}

