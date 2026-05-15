// Input: Group name, count, collapse state
// Output: Collapsible group header row for list view
// Position: List view group separator

import { ChevronDownIcon } from 'lucide-react'
import { m } from 'motion/react'

import { cn } from '~/lib/cn'

import type { StatusCategory } from './use-view-config'
import { StatusIcon } from './shared/status-icon'

interface GroupHeaderProps {
  name: string
  count: number
  category?: StatusCategory
  collapsed: boolean
  onToggle: () => void
}

export function KanbanGroupHeader({ name, count, category, collapsed, onToggle }: GroupHeaderProps) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        'h-8 w-full flex items-center gap-2 px-3 text-[12px] font-medium text-muted-foreground',
        'hover:bg-muted transition-[background-color] duration-150 ease-out',
      )}
    >
      <m.span
        animate={{ rotate: collapsed ? -90 : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 35, mass: 0.8 }}
        className="flex items-center"
      >
        <ChevronDownIcon className="size-3.5" />
      </m.span>
      {category && <StatusIcon category={category} size={14} />}
      <span>{name}</span>
      <span className="text-muted-foreground tabular-nums">{count}</span>
    </button>
  )
}
