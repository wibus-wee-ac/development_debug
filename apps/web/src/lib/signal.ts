// Input: PushEventMap types
// Output: useSignal hook + raw subscribe helper for typed push event consumption
// Position: apps/web/src/lib/signal.ts — in-memory event bus (web replacement for window.cradle preload bridge)

import type { PushEventMap, PushTopic } from '@shared/push-events'
import { useEffect, useRef } from 'react'

type Listener<T> = (payload: T) => void

const listeners = new Map<string, Set<Listener<unknown>>>()

/**
 * Publish an event to all subscribers of a topic.
 * Called by SSE transport layers when server pushes arrive.
 */
export function publish<T extends PushTopic>(topic: T, payload: PushEventMap[T]): void {
  const subs = listeners.get(topic)
  if (!subs) {
    return
  }
  for (const fn of subs) {
    fn(payload as unknown)
  }
}

/**
 * Raw subscription — returns unsubscribe function.
 * Use outside React or in module-level setup.
 */
export function subscribe<T extends PushTopic>(
  topic: T,
  listener: (payload: PushEventMap[T]) => void,
): () => void {
  let subs = listeners.get(topic)
  if (!subs) {
    subs = new Set()
    listeners.set(topic, subs)
  }
  subs.add(listener as Listener<unknown>)
  return () => {
    subs!.delete(listener as Listener<unknown>)
  }
}

/**
 * React hook — subscribes to a push topic for the component lifecycle.
 * Handler reference is stable (latest-ref pattern).
 */
export function useSignal<T extends PushTopic>(
  topic: T,
  handler: (payload: PushEventMap[T]) => void,
): void {
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  })

  useEffect(() => {
    return subscribe(topic, (payload) => {
      handlerRef.current(payload as PushEventMap[T])
    })
  }, [topic])
}
