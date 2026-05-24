import type { StoreApi, UseBoundStore } from 'zustand'

interface PersistedStoreSyncMessage<TPersisted> {
  type: 'persisted-state'
  sourceId: string
  persistKey: string
  state: TPersisted
}

export interface PersistedStoreSyncOptions<TState, TPersisted> {
  store: StoreApi<TState> | UseBoundStore<StoreApi<TState>>
  persistKey: string
  channelName: string
  selectPersistedState: (state: TState) => TPersisted
  applyPersistedState: (persistedState: unknown) => void
  isSamePersistedState?: (left: TPersisted, right: TPersisted) => boolean
}

export interface PersistedStoreSyncHandle {
  dispose: () => void
}

function createSourceId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  return Math.random().toString(36).slice(2)
}

function defaultStateEquals<TPersisted>(left: TPersisted, right: TPersisted): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  }
  catch {
    return false
  }
}

function readPersistedStorageState(storageValue: string | null): unknown {
  if (!storageValue) {
    return undefined
  }

  try {
    const parsed = JSON.parse(storageValue) as { state?: unknown }
    return parsed.state
  }
  catch {
    return undefined
  }
}

export function installPersistedStoreSync<TState, TPersisted>(
  options: PersistedStoreSyncOptions<TState, TPersisted>,
): PersistedStoreSyncHandle {
  const {
    store,
    persistKey,
    channelName,
    selectPersistedState,
    applyPersistedState,
    isSamePersistedState = defaultStateEquals,
  } = options

  const sourceId = createSourceId()
  let applyingRemoteState = false
  let disposed = false
  let latestPersistedState = selectPersistedState(store.getState())
  const channel = typeof BroadcastChannel === 'undefined'
    ? null
    : new BroadcastChannel(channelName)

  const publish = (state: TPersisted) => {
    if (!channel || disposed) {
      return
    }

    channel.postMessage({
      type: 'persisted-state',
      sourceId,
      persistKey,
      state,
    } satisfies PersistedStoreSyncMessage<TPersisted>)
  }

  const applyRemoteState = (state: unknown) => {
    if (disposed || state === undefined) {
      return
    }

    applyingRemoteState = true
    try {
      applyPersistedState(state)
      latestPersistedState = selectPersistedState(store.getState())
    }
    catch {
      // Ignore malformed remote state so one bad window cannot break local usage.
    }
    finally {
      applyingRemoteState = false
    }
  }

  const unsubscribe = store.subscribe((state) => {
    const nextPersistedState = selectPersistedState(state)
    if (applyingRemoteState || isSamePersistedState(latestPersistedState, nextPersistedState)) {
      latestPersistedState = nextPersistedState
      return
    }

    latestPersistedState = nextPersistedState
    publish(nextPersistedState)
  })

  if (channel) {
    channel.onmessage = (event: MessageEvent<PersistedStoreSyncMessage<TPersisted>>) => {
      const message = event.data
      if (
        !message
        || message.type !== 'persisted-state'
        || message.sourceId === sourceId
        || message.persistKey !== persistKey
      ) {
        return
      }

      applyRemoteState(message.state)
    }
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== persistKey) {
      return
    }

    applyRemoteState(readPersistedStorageState(event.newValue))
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorage)
  }

  return {
    dispose: () => {
      disposed = true
      unsubscribe()
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', handleStorage)
      }
      channel?.close()
    },
  }
}
