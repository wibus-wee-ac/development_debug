// Input: kanban issue metadata fields stored as primitives or JSON text
// Output: typed helpers for labels and priority display options
// Position: shared kanban metadata utilities used by board, detail, and create flows

import type { IssuePriority } from '../use-kanban'

export const priorityOptions: { value: IssuePriority, label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'none', label: 'No priority' },
]

export function parseIssueLabels(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  }
  catch {
    return []
  }
}
