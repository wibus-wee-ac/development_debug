import type { IssuePriority } from '../use-kanban'
import { z } from 'zod'

export const priorityOptions: { value: IssuePriority, label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'none', label: 'No priority' },
]

export const IssueLabelsJsonSchema = z.string()
  .nullish()
  .transform(raw => JSON.parse(raw ?? '[]'))
  .pipe(z.array(z.string()).default([]))
