// Input: ApprovalService events, SignalBroadcaster
// Output: Subscriber that pushes approval lifecycle events to renderer via unified signal bridge
// Position: Approval feature subscriber — pushes approval requests/resolutions to all renderer windows

import type { SignalBroadcaster } from '../signal/broadcaster'
import type { ApprovalService, PendingApproval } from './approval-service'

export interface ApprovalBroadcastDeps {
  approvalService: ApprovalService
  broadcaster: SignalBroadcaster
}

export function createApprovalBroadcastSubscriber(deps: ApprovalBroadcastDeps): () => void {
  const { approvalService, broadcaster } = deps

  const unsubRequested = approvalService.onRequested((approval) => {
    broadcaster.broadcastGlobal('approval:requested', approval)
  })

  const unsubResolved = approvalService.onResolved((approvalId, response) => {
    broadcaster.broadcastGlobal('approval:resolved', { approvalId, ...response })
  })

  return () => {
    unsubRequested()
    unsubResolved()
  }
}

export type { PendingApproval }
