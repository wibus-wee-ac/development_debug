/**
 * Output: Milestone progress summary for issue detail banners.
 * Input: Workspace issues, statuses, and the selected milestone id.
 * Position: Issue Detail helper for rendering Issue-owned milestone metadata.
 */

import type { KanbanIssue, KanbanStatus } from '~/lib/types'

export interface MilestoneProgressSummary {
  total: number
  completed: number
  percentage: number
}

export function calculateMilestoneProgress(
  issues: KanbanIssue[],
  statuses: KanbanStatus[],
  milestoneId: string | null,
): MilestoneProgressSummary {
  if (!milestoneId) {
    return { total: 0, completed: 0, percentage: 0 }
  }

  const statusById = new Map(statuses.map(status => [status.id, status]))
  let total = 0
  let completed = 0

  for (const issue of issues) {
    if (issue.milestoneId !== milestoneId) {
      continue
    }

    total += 1

    if (statusById.get(issue.statusId ?? '')?.category === 'completed') {
      completed += 1
    }
  }

  return {
    total,
    completed,
    percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
  }
}
