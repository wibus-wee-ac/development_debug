// Input: UIMessageChunk and persistence metadata
// Output: stored chunk codecs for chat-runtime persistence
// Position: apps/server/src/modules/chat-runtime/timeline-events.ts

import type { UIMessageChunk } from 'ai'

export const TIMELINE_SCHEMA_VERSION = 'cradle.chunk.v2' as const

export interface ChunkContext {
  parentToolCallId?: string | null
  taskId?: string | null
}

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
  parentToolCallId: string | null
  taskId: string | null
  chunk: UIMessageChunk
}

export function encodeChunk(chunk: UIMessageChunk, ctx?: ChunkContext): {
  eventType: string
  schemaVersion: typeof TIMELINE_SCHEMA_VERSION
  payloadJson: string
  sourceJson: string
  parentToolCallId: string | null
  taskId: string | null
} {
  return {
    eventType: chunk.type,
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    payloadJson: JSON.stringify(chunk),
    sourceJson: '{}', // no longer needed
    parentToolCallId: ctx?.parentToolCallId ?? null,
    taskId: ctx?.taskId ?? null,
  }
}

/**
 * Extract ChunkContext from a chunk's providerMetadata.cradle fields.
 */
export function extractChunkContext(chunk: UIMessageChunk): ChunkContext {
  const meta = 'providerMetadata' in chunk
    ? (chunk as { providerMetadata?: { cradle?: { parentToolUseId?: string; taskId?: string } } }).providerMetadata?.cradle
    : undefined
  return {
    parentToolCallId: meta?.parentToolUseId ?? null,
    taskId: meta?.taskId ?? null,
  }
}

export function decodeChunk(input: {
  payloadJson: string
}): UIMessageChunk {
  return JSON.parse(input.payloadJson) as UIMessageChunk
}
