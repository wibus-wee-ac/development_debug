// Input: unified signal bridge (window.cradle.subscribe), HTTP approval API
// Output: useApprovalRequests hook for subscribing to pending approval lifecycle
// Position: Renderer approval feature — real-time approval state management

import type {
  ApprovalRequestedPayload,
  ApprovalResolvedPayload,
} from '~/lib/contracts/approval-events'
import { useCallback, useSyncExternalStore } from 'react'

import { getApprovals, postApprovalsByApprovalIdRespond } from '~/api-gen'

const SERVER_BASE: string = (import.meta.env as Record<string, string>).VITE_SERVER_URL ?? 'http://localhost:21423'

// ── Module-level state ──────────────────────────────────────

let pendingApprovals: ApprovalRequestedPayload[] = []
const listeners = new Set<() => void>()

let _subscribed = false
let _pollTimer: ReturnType<typeof setInterval> | null = null

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

function mergeApprovals(items: ApprovalRequestedPayload[]): void {
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

  // Polling fallback — checks every 2s regardless of SSE status
  _pollTimer = setInterval(() => {
    void getApprovals().then((res) => {
      const items = (res.data ?? []) as ApprovalRequestedPayload[]
      if (items.length > 0) {
        console.warn(`[approval] poll: ${items.length} pending approval(s)`, items.map(i => i.id))
        mergeApprovals(items)
      }
      else if (pendingApprovals.length > 0) {
        // Server has no pending — clear local state
        pendingApprovals = []
        notify()
      }
    }).catch((err) => {
      console.warn('[approval] poll error:', err)
    })
  }, 2000)
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
 * Automatically subscribes to incoming approval events via signal bus + polling.
 */
export function useApprovalRequests(): {
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
