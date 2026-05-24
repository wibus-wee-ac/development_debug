import { toastManager } from '~/components/ui/toast'

import { getServerUrl } from './electron'

interface SourceSyncErrorEvent {
  type: 'source_sync_error'
  data: {
    sourceKey: string
    label: string
    error: string
  }
}

interface DaemonErrorEvent {
  type: 'daemon_error'
  data: {
    daemon: string
    error: string
  }
}

type ServerStatusEvent = SourceSyncErrorEvent | DaemonErrorEvent

export function connectServerEvents(): () => void {
  const es = new EventSource(`${getServerUrl()}/server/events`)

  es.onmessage = (e) => {
    try {
      const event: ServerStatusEvent = JSON.parse(e.data)
      switch (event.type) {
        case 'source_sync_error':
          toastManager.add({
            type: 'error',
            title: `${event.data.label} sync failed`,
            description: event.data.error,
          })
          break
        case 'daemon_error':
          toastManager.add({
            type: 'error',
            title: `${event.data.daemon} daemon error`,
            description: event.data.error,
          })
          break
      }
    }
    catch {
      // ignore malformed events
    }
  }

  es.onerror = () => {
    // EventSource will auto-reconnect
  }

  return () => es.close()
}
