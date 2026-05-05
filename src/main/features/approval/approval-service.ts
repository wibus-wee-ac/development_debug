// Input: ACP/backend permission request parameters, renderer approval responses
// Output: Approval service singleton managing pending approval lifecycle with Promise-based resolution
// Position: Feature owner for Cradle's product-level approval workflow between backends and renderer

import { randomUUID } from 'node:crypto'

export type ApprovalDecision = 'approved' | 'rejected'

export interface ApprovalOption {
  optionId: string
  label: string
  description?: string
}

export interface PendingApproval {
  id: string
  chatSessionId: string | null
  agentId: string
  prompt: string
  options: ApprovalOption[]
  createdAt: number
}

export interface ApprovalResponse {
  decision: ApprovalDecision
  selectedOptionId: string
}

interface PendingEntry {
  approval: PendingApproval
  resolve: (response: ApprovalResponse) => void
}

export type ApprovalRequestedListener = (approval: PendingApproval) => void
export type ApprovalResolvedListener = (approvalId: string, response: ApprovalResponse) => void

export interface ApprovalService {
  /**
   * Request approval from the user.
   * Returns a Promise that resolves when the user responds.
   */
  requestApproval: (input: RequestApprovalInput) => Promise<ApprovalResponse>

  /** Respond to a pending approval (called from renderer via IPC). */
  respondApproval: (approvalId: string, response: ApprovalResponse) => void

  /** List all currently pending approvals. */
  listPending: () => PendingApproval[]

  /** Subscribe to new incoming approval requests. */
  onRequested: (listener: ApprovalRequestedListener) => () => void

  /** Subscribe to approval resolutions. */
  onResolved: (listener: ApprovalResolvedListener) => () => void
}

export interface RequestApprovalInput {
  chatSessionId?: string | null
  agentId: string
  prompt: string
  options: ApprovalOption[]
}

export function createApprovalService(): ApprovalService {
  const pending = new Map<string, PendingEntry>()
  const requestedListeners = new Set<ApprovalRequestedListener>()
  const resolvedListeners = new Set<ApprovalResolvedListener>()

  return {
    requestApproval(input) {
      const id = randomUUID()
      const approval: PendingApproval = {
        id,
        chatSessionId: input.chatSessionId ?? null,
        agentId: input.agentId,
        prompt: input.prompt,
        options: input.options,
        createdAt: Date.now(),
      }

      return new Promise<ApprovalResponse>((resolve) => {
        pending.set(id, { approval, resolve })
        for (const listener of [...requestedListeners]) {
          try {
            listener(approval)
          }
          catch {
            // listeners must not break the request flow
          }
        }
      })
    },

    respondApproval(approvalId, response) {
      const entry = pending.get(approvalId)
      if (!entry) {
        return
      }
      pending.delete(approvalId)
      entry.resolve(response)

      for (const listener of [...resolvedListeners]) {
        try {
          listener(approvalId, response)
        }
        catch {
          // listeners must not break the resolution flow
        }
      }
    },

    listPending() {
      return Array.from(pending.values(), e => e.approval)
    },

    onRequested(listener) {
      requestedListeners.add(listener)
      return () => {
        requestedListeners.delete(listener)
      }
    },

    onResolved(listener) {
      resolvedListeners.add(listener)
      return () => {
        resolvedListeners.delete(listener)
      }
    },
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let instance: ApprovalService | null = null

export function getApprovalService(): ApprovalService {
  if (!instance) {
    instance = createApprovalService()
  }
  return instance
}

export function resetApprovalServiceForTests(): void {
  instance = null
}
