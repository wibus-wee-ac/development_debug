// Input: window.cradle unified bridge, PushEventMap types
// Output: useSignal hook + raw subscribe helper for typed push event consumption
// Position: Renderer-side typed subscription utility for the unified signal bridge

import type { PushEventMap, PushTopic } from '@shared/push-events'
import { useEffect, useRef } from 'react'

/**
 * Raw subscription — returns unsubscribe function.
 * Use outside React or in module-level setup.
 */
export function subscribe<T extends PushTopic>(
  topic: T,
  listener: (payload: PushEventMap[T]) => void,
): () => void {
  return window.cradle.subscribe(topic, listener)
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
    return window.cradle.subscribe(topic, (payload) => {
      handlerRef.current(payload as PushEventMap[T])
    })
  }, [topic])
}
