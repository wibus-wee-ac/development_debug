// Input: priority enum values
// Output: priorityLabel map and priorityOrder array
// Position: Shared constants for kanban priority display

export const priorityLabel: Record<string, string> = {
  none: '无优先级',
  low: '低',
  medium: '中',
  high: '高',
  urgent: '紧急',
}

export type PriorityValue = 'urgent' | 'high' | 'medium' | 'low' | 'none'

export const priorityOrder: PriorityValue[] = ['urgent', 'high', 'medium', 'low', 'none']
