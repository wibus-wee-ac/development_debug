import { describe, expect, it } from 'vitest'

import type { ApprovalRequestedPayload } from '~/lib/contracts/approval-events'
import { clearPendingApprovals, mergePendingApprovals, removePendingApproval } from './approval-state'

function approval(id: string, chatSessionId = 'session-1'): ApprovalRequestedPayload {
  return {
    id,
    chatSessionId,
    agentId: 'agent-1',
    prompt: `Approve ${id}?`,
    options: [
      { optionId: `${id}-allow`, label: 'Allow', description: 'allow_once' },
      { optionId: `${id}-reject`, label: 'Deny', description: 'reject_once' },
    ],
    createdAt: 1_779_120_000_000,
  }
}

describe('approval state helpers', () => {
  it('merges new approvals while preserving existing order and identity when unchanged', () => {
    const current = [approval('approval-1')]
    const merged = mergePendingApprovals(current, [
      approval('approval-1'),
      approval('approval-2'),
    ])

    expect(merged.map(item => item.id)).toEqual(['approval-1', 'approval-2'])
    expect(mergePendingApprovals(current, [approval('approval-1')])).toBe(current)
    expect(mergePendingApprovals(current, [])).toBe(current)
  })

  it('removes resolved approvals and keeps identity when the id is absent', () => {
    const current = [approval('approval-1'), approval('approval-2')]

    expect(removePendingApproval(current, 'approval-1').map(item => item.id)).toEqual(['approval-2'])
    expect(removePendingApproval(current, 'missing')).toBe(current)
  })

  it('clears pending approvals only when there is stale local state', () => {
    const current = [approval('approval-1')]
    const empty: ApprovalRequestedPayload[] = []

    expect(clearPendingApprovals(current)).toEqual([])
    expect(clearPendingApprovals(empty)).toBe(empty)
  })
})
