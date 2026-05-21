import type { ApprovalRequestedPayload } from '~/lib/contracts/approval-events'

export function mergePendingApprovals(
  current: ApprovalRequestedPayload[],
  incoming: ApprovalRequestedPayload[],
): ApprovalRequestedPayload[] {
  if (incoming.length === 0) {
    return current
  }

  const existingIds = new Set(current.map(approval => approval.id))
  let changed = false
  const next = [...current]

  for (const approval of incoming) {
    if (!existingIds.has(approval.id)) {
      existingIds.add(approval.id)
      next.push(approval)
      changed = true
    }
  }

  return changed ? next : current
}

export function removePendingApproval(
  current: ApprovalRequestedPayload[],
  approvalId: string,
): ApprovalRequestedPayload[] {
  const next = current.filter(approval => approval.id !== approvalId)
  return next.length === current.length ? current : next
}

export function clearPendingApprovals(current: ApprovalRequestedPayload[]): ApprovalRequestedPayload[] {
  return current.length === 0 ? current : []
}
