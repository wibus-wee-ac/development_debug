// Output: Chat Runtime session status HTTP reader.
// Input: Chat session id.
// Position: Chat feature API boundary for Right Aside runtime status surfaces.

import type { RuntimeKind } from '~/lib/types'
import { getServerUrl } from '~/lib/electron'

const SERVER_BASE = getServerUrl()

export type RuntimeSessionStatusKind = 'idle' | 'pending' | 'streaming' | 'cancelling'
export type RuntimePermissionMode = 'bypassPermissions' | 'plan'
export type RuntimeRunStatus = 'streaming' | 'complete' | 'aborted' | 'failed'

export interface RuntimeSessionRunStatus {
  runId: string
  messageId: string | null
  status: RuntimeRunStatus
  startedAt: number
  finishedAt: number | null
  modelId: string | null
  providerSessionId: string | null
  queueItemId: string | null
  permissionMode: RuntimePermissionMode | null
}

export interface RuntimeSessionStatus {
  sessionId: string
  status: RuntimeSessionStatusKind
  runtimeKind: RuntimeKind
  providerTargetId: string | null
  providerSessionId: string | null
  modelId: string | null
  permissionMode: RuntimePermissionMode | null
  pendingQueueItemId: string | null
  activeRun: RuntimeSessionRunStatus | null
  latestRun: RuntimeSessionRunStatus | null
  queue: {
    pending: number
    running: number
  }
}

export async function getRuntimeSessionStatus(sessionId: string): Promise<RuntimeSessionStatus> {
  const res = await fetch(`${SERVER_BASE}/chat/sessions/${sessionId}/runtime-status`)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Failed to get runtime session status: ${res.status} ${body}`)
  }
  return await res.json() as RuntimeSessionStatus
}
