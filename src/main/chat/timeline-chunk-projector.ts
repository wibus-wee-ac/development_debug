// Input: TimelineInputEvent / BackendTimelineEvent (domain-level timeline facts)
// Output: UIMessageChunk[] for real-time broadcast to renderer
// Position: Stateless projector that converts domain timeline events into AI SDK streaming chunks

import type { UIMessageChunk } from 'ai'

import type { BackendTimelineEvent, TimelineInputEvent } from '../backend-control-plane/timeline-events'
import { projectTimelineEventToChatChunks } from '../backend-control-plane/timeline-events'

export interface TimelineChunkProjector {
  /** Project a timeline event into UIMessageChunks for real-time broadcast. */
  apply: (event: TimelineInputEvent | BackendTimelineEvent) => UIMessageChunk[]
}

/**
 * Create a stateless timeline chunk projector.
 * Pure delegation to `projectTimelineEventToChatChunks` — no UIMessage accumulation.
 */
export function createTimelineChunkProjector(): TimelineChunkProjector {
  return {
    apply(event) {
      return projectTimelineEventToChatChunks(event)
    },
  }
}
