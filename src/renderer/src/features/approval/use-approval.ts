// Input: unified signal bridge (window.cradle.subscribe), approval IPC service
// Output: useApprovalRequests hook for subscribing to pending approval lifecycle
// Position: Renderer approval feature — real-time approval state management

import { ipc } from '@renderer/lib/ipc'
import { subscribe as subscribeSignal } from '@renderer/lib/signal'
import type {
  ApprovalRequestedPayload,
  ApprovalResolvedPayload,
} from '@shared/approval-events'
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'

// ── Module-level state ──────────────────────────────────────

let pendingApprovals: ApprovalRequestedPayload[] = []
const listeners = new Set<() => void>()

let _requestedUnsub: (() => void) | null = null

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

function ensureSubscription(): void {
  if (_requestedUnsub) {
    return
  }
  _requestedUnsub = subscribeSignal('approval:requested', (payload: ApprovalRequestedPayload) => {
    pendingApprovals = [...pendingApprovals, payload]
    notify()
  })
  subscribeSignal('approval:resolved', (payload: ApprovalResolvedPayload) => {
    pendingApprovals = pendingApprovals.filter(a => a.id !== payload.approvalId)
    notify()
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
 * Automatically subscribes to incoming approval events via IPC push.
 */
export function useApprovalRequests(): {
  pending: ApprovalRequestedPayload[]
  respond: (approvalId: string, decision: 'approved' | 'rejected', selectedOptionId: string) => void
} {
  const pending = useSyncExternalStore(subscribe, getSnapshot)

  const respond = useCallback((approvalId: string, decision: 'approved' | 'rejected', selectedOptionId: string) => {
    ipc!.approval.respond(approvalId, { decision, selectedOptionId })
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
    : []
  return { pending: filtered, respond }
}

/**
 * Load initial pending approvals from main process on mount.
 */
export function useApprovalInit(): void {
  const loadedRef = useRef(false)
  useEffect(() => {
    if (loadedRef.current) {
      return
    }
    loadedRef.current = true
    ipc!.approval.listPending().then((items: ApprovalRequestedPayload[]) => {
      if (items.length > 0) {
        pendingApprovals = items
        notify()
      }
    })
  }, [])
}
