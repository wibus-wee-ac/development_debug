import { ArrowLeftIcon, MoreHorizontalIcon, TrashIcon } from 'lucide-react'

import type { KanbanIssue } from '~/lib/types'

import { Menu, MenuItem, MenuPopup, MenuTrigger } from '~/components/ui/menu'

interface IssueHeaderProps {
  issue: KanbanIssue
  onBack: () => void
  onDelete: () => void
}

export function IssueHeader({ issue, onBack, onDelete }: IssueHeaderProps) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border/50 px-4" data-testid="issue-detail-header">
      <button
        type="button"
        onClick={onBack}
        className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-fill hover:text-foreground transition-colors"
        data-testid="issue-detail-close-btn"
      >
        <ArrowLeftIcon className="size-4" />
      </button>

      <span className="font-mono text-[12px] text-muted-foreground">
        {issue.id.slice(0, 8).toUpperCase()}
      </span>

      <div className="flex-1" />

      <Menu>
        <MenuTrigger
          className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-fill hover:text-foreground transition-colors"
          data-testid="issue-detail-menu-trigger"
        >
          <MoreHorizontalIcon className="size-4" />
        </MenuTrigger>
        <MenuPopup>
          <MenuItem
            onClick={onDelete}
            className="text-red-500"
            data-testid="issue-detail-delete-issue"
          >
            <TrashIcon className="size-3.5 mr-2" />
            Delete issue
          </MenuItem>
        </MenuPopup>
      </Menu>
    </div>
  )
}
