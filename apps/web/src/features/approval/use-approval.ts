// Input: SSE approval stream, HTTP approval API
// Output: useApprovalRequests hook for subscribing to pending approval lifecycle
// Position: Renderer approval feature — real-time approval state management

import { useCallback, useSyncExternalStore } from 'react'

import { postApprovalsByApprovalIdRespond } from '~/api-gen'
import type {
  ApprovalRequestedPayload,
  ApprovalResolvedPayload,
} from '~/lib/contracts/approval-events'
import { getServerUrl } from '~/lib/electron'

const SERVER_BASE = getServerUrl()

// ── Module-level state ──────────────────────────────────────

let pendingApprovals: ApprovalRequestedPayload[] = []
const listeners = new Set<() => void>()

let _subscribed = false

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

function _mergeApprovals(items: ApprovalRequestedPayload[]): void {
  const existingIds = new Set(pendingApprovals.map(a => a.id))
  let changed = false
  for (const item of items) {
    if (!existingIds.has(item.id)) {
      pendingApprovals = [...pendingApprovals, item]
      changed = true
    }
  }
  if (changed) {
    notify()
  }
}

function ensureSubscription(): void {
  if (_subscribed) {
    return
  }
  _subscribed = true

  // Direct SSE connection to approval stream
  const es = new EventSource(`${SERVER_BASE}/approvals/stream`)

  es.addEventListener('open', () => {
    // Reset on (re)connect so the initial burst fully replaces local state
    pendingApprovals = []
  })

  es.addEventListener('approval.requested', (ev: MessageEvent) => {
    try {
      const payload = JSON.parse(ev.data) as ApprovalRequestedPayload
      if (!pendingApprovals.some(a => a.id === payload.id)) {
        pendingApprovals = [...pendingApprovals, payload]
        notify()
      }
    }
    catch { /* malformed JSON — skip */ }
  })

  es.addEventListener('approval.resolved', (ev: MessageEvent) => {
    try {
      const payload = JSON.parse(ev.data) as ApprovalResolvedPayload
      pendingApprovals = pendingApprovals.filter(a => a.id !== payload.approvalId)
      notify()
    }
    catch { /* malformed JSON — skip */ }
  })
}

function subscribe(listener: () => void): () => void {
  ensureSubscription()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): ApprovalRequestedPayload[] {
  return pendingApprovals
}

// ── Hook ────────────────────────────────────────────────────

/**
 * Returns the current list of pending approval requests.
 * Automatically subscribes to incoming approval events via SSE.
 */
function useApprovalRequests(): {
  pending: ApprovalRequestedPayload[]
  respond: (approvalId: string, decision: 'approved' | 'rejected', selectedOptionId: string) => void
} {
  const pending = useSyncExternalStore(subscribe, getSnapshot)

  const respond = useCallback((approvalId: string, decision: 'approved' | 'rejected', selectedOptionId: string) => {
    // Optimistic removal
    pendingApprovals = pendingApprovals.filter(a => a.id !== approvalId)
    notify()
    void postApprovalsByApprovalIdRespond({ path: { approvalId }, body: { decision, selectedOptionId } })
  }, [])

  return { pending, respond }
}

/**
 * Returns pending approvals filtered by chat session ID.
 */
export function useSessionApprovalRequests(chatSessionId: string | null | undefined): {
  pending: ApprovalRequestedPayload[]
  respond: (approvalId: string, decision: 'approved' | 'rejected', selectedOptionId: string) => void
} {
  const { pending: allPending, respond } = useApprovalRequests()
  const filtered = chatSessionId
    ? allPending.filter(a => a.chatSessionId === chatSessionId)
    : allPending // Show all approvals if no specific session
  return { pending: filtered, respond }
}
