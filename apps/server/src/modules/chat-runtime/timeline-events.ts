// Input: UIMessageChunk and persistence metadata
// Output: stored chunk codecs for chat-runtime persistence
// Position: apps/server/src/modules/chat-runtime/timeline-events.ts

import type { UIMessageChunk } from 'ai'

export const TIMELINE_SCHEMA_VERSION = 'cradle.chunk.v2' as const

/**
 * A persisted UIMessageChunk with DB metadata.
 */
export interface StoredChunk {
  id: string
  runId: string
  chatSessionId: string
  sequenceNumber: number
  schemaVersion: typeof TIMELINE_SCHEMA_VERSION
  createdAt: number
  chunk: UIMessageChunk
}

export function encodeChunk(chunk: UIMessageChunk): {
  eventType: string
  schemaVersion: typeof TIMELINE_SCHEMA_VERSION
  payloadJson: string
  sourceJson: string
} {
  return {
    eventType: chunk.type,
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    payloadJson: JSON.stringify(chunk),
    sourceJson: '{}', // no longer needed
  }
}

export function decodeChunk(input: {
  payloadJson: string
}): UIMessageChunk {
  return JSON.parse(input.payloadJson) as UIMessageChunk
}
