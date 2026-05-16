import { ArrowLeftIcon, ChevronRightIcon, MoreHorizontalIcon, TrashIcon } from 'lucide-react'

import type { KanbanIssue, KanbanStatus } from '~/lib/types'

import { Menu, MenuItem, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import { StatusIcon } from '../shared/status-icon'
import type { StatusCategory } from '../use-view-config'

interface IssueHeaderProps {
  issue: KanbanIssue
  status?: KanbanStatus
  onBack: () => void
  onDelete: () => void
}

export function IssueHeader({ issue, status, onBack, onDelete }: IssueHeaderProps) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border px-3" data-testid="issue-detail-header">
      <button
        type="button"
        onClick={onBack}
        className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-fill hover:text-foreground transition-colors shrink-0"
        data-testid="issue-detail-close-btn"
      >
        <ArrowLeftIcon className="size-4" />
      </button>

      {/* Breadcrumb: Status → Issue title */}
      <div className="flex items-center gap-1.5 min-w-0 text-[13px]">
        {status && (
          <>
            <span className="flex items-center gap-1.5 text-muted-foreground shrink-0">
              <StatusIcon category={status.category as StatusCategory} size={13} />
              <span>{status.name}</span>
            </span>
            <ChevronRightIcon className="size-3 text-muted-foreground/50 shrink-0" />
          </>
        )}
        <span className="text-foreground font-medium truncate">{issue.title}</span>
      </div>

      <div className="flex-1" />

      <Menu>
        <MenuTrigger
          className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-fill hover:text-foreground transition-colors shrink-0"
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
