// Input: server SSE endpoint /approvals/stream
// Output: connectApprovalStream — subscribes to real-time approval events and publishes to signal bus
// Position: apps/web/src/features/approval/sse-approval-connector.ts

import type { ApprovalRequestedPayload } from '@shared/approval-events'

import { getApprovals } from '~/api-gen'
import { publish } from '~/lib/signal'

const SERVER_BASE: string = (import.meta.env as Record<string, string>).VITE_SERVER_URL ?? 'http://localhost:21423'

/** Known approval IDs to avoid duplicate publishes from polling + SSE */
const knownIds = new Set<string>()

function publishApproval(payload: ApprovalRequestedPayload): void {
  if (knownIds.has(payload.id)) {
    return
  }
  knownIds.add(payload.id)
  publish('approval:requested', payload)
}

/**
 * Open a persistent SSE connection to /approvals/stream via EventSource.
 * Falls back to polling if EventSource fails.
 * Returns a cleanup function.
 */
export function connectApprovalStream(): () => void {
  let stopped = false
  let pollTimer: ReturnType<typeof setInterval> | null = null

  const es = new EventSource(`${SERVER_BASE}/approvals/stream`)

  es.addEventListener('approval.requested', (ev: MessageEvent) => {
    try {
      const payload = JSON.parse(ev.data) as ApprovalRequestedPayload
      publishApproval(payload)
    }
    catch {
      // malformed JSON — skip
    }
  })

  es.addEventListener('approval.resolved', (ev: MessageEvent) => {
    try {
      const payload = JSON.parse(ev.data) as Record<string, unknown>
      const approvalId = payload.approvalId as string
      knownIds.delete(approvalId)
      publish('approval:resolved', {
        approvalId,
        decision: payload.decision as 'approved' | 'rejected',
        selectedOptionId: payload.selectedOptionId as string,
      })
    }
    catch {
      // malformed JSON — skip
    }
  })

  // Fallback: if EventSource errors, start polling
  es.onerror = () => {
    if (stopped) {
      return
    }
    if (!pollTimer) {
      pollTimer = setInterval(() => {
        if (stopped) {
          return
        }
        void getApprovals().then((res) => {
          const items = (res.data ?? []) as ApprovalRequestedPayload[]
          for (const item of items) {
            publishApproval(item)
          }
        })
      }, 2000)
    }
  }

  return () => {
    stopped = true
    es.close()
    if (pollTimer) {
      clearInterval(pollTimer)
    }
  }
}
