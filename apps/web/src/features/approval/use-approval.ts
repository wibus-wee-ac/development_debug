import { useCallback, useSyncExternalStore } from 'react'
import { z } from 'zod'

import { postApprovalsByApprovalIdRespond } from '~/api-gen'
import type {
  ApprovalRequestedPayload,
  ApprovalResolvedPayload,
} from '~/lib/contracts/approval-events'
import { getServerUrl } from '~/lib/electron'
import { clearPendingApprovals, mergePendingApprovals, removePendingApproval } from './approval-state'

const SERVER_BASE = getServerUrl()

const ApprovalOptionPayloadSchema = z.object({
  optionId: z.string(),
  label: z.string(),
  description: z.string().optional(),
})

const ApprovalRequestedPayloadJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.object({
    id: z.string(),
    chatSessionId: z.string().nullable(),
    agentId: z.string(),
    prompt: z.string(),
    options: z.array(ApprovalOptionPayloadSchema),
    createdAt: z.number(),
  }))

const ApprovalResolvedPayloadJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.object({
    approvalId: z.string(),
    decision: z.enum(['approved', 'rejected']),
    selectedOptionId: z.string(),
  }))

// ── Module-level state ──────────────────────────────────────

let pendingApprovals: ApprovalRequestedPayload[] = []
const listeners = new Set<() => void>()

let _subscribed = false

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

function setPendingApprovals(next: ApprovalRequestedPayload[]): void {
  if (next !== pendingApprovals) {
    pendingApprovals = next
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
    setPendingApprovals(clearPendingApprovals(pendingApprovals))
  })

  es.addEventListener('approval.requested', (ev: MessageEvent) => {
    const payload = ApprovalRequestedPayloadJsonSchema.parse(ev.data) satisfies ApprovalRequestedPayload
    setPendingApprovals(mergePendingApprovals(pendingApprovals, [payload]))
  })

  es.addEventListener('approval.resolved', (ev: MessageEvent) => {
    const payload = ApprovalResolvedPayloadJsonSchema.parse(ev.data) satisfies ApprovalResolvedPayload
    setPendingApprovals(removePendingApproval(pendingApprovals, payload.approvalId))
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
    setPendingApprovals(removePendingApproval(pendingApprovals, approvalId))
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
