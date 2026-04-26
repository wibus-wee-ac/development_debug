// Input: priority string enum
// Output: PriorityIcon component — colored icon per priority level (Linear-style)
// Position: Shared UI atom for kanban issue cards and detail views

import { cn } from '@renderer/lib/utils'
import {
  AlertTriangleIcon,
  ArrowDownIcon,
  EqualIcon,
  MinusIcon,
  SignalHighIcon,
} from 'lucide-react'

const priorityConfig = {
  none: { icon: MinusIcon, className: 'text-muted-foreground/40' },
  low: { icon: ArrowDownIcon, className: 'text-blue-500' },
  medium: { icon: EqualIcon, className: 'text-yellow-500' },
  high: { icon: SignalHighIcon, className: 'text-orange-500' },
  urgent: { icon: AlertTriangleIcon, className: 'text-red-500' },
} as const

type Priority = keyof typeof priorityConfig

interface PriorityIconProps {
  priority: Priority | string
  className?: string
}

export function PriorityIcon({ priority, className }: PriorityIconProps) {
  const config = priorityConfig[priority as Priority] ?? priorityConfig.none
  const Icon = config.icon
  return <Icon className={cn('size-3.5', config.className, className)} />
}
