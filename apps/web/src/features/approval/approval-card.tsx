import { CheckIcon, XIcon } from 'lucide-react'

import type { ApprovalRequestedPayload } from '~/lib/contracts/approval-events'
import { cn } from '~/lib/cn'

import { useSessionApprovalRequests } from './use-approval'

interface ApprovalCardProps {
  approval: ApprovalRequestedPayload
  onRespond: (approvalId: string, decision: 'approved' | 'rejected', selectedOptionId: string) => void
}

export function ApprovalCard({ approval, onRespond }: ApprovalCardProps) {
  const allowOnceOption = approval.options.find(o => o.description === 'allow_once')
  const allowAlwaysOption = approval.options.find(o => o.description === 'allow_always')
  const rejectOption = approval.options.find(o => o.description === 'reject_once' || o.description === 'reject_always')

  const handleAllowOnce = () => {
    if (allowOnceOption) {
      onRespond(approval.id, 'approved', allowOnceOption.optionId)
    }
  }

  const handleAllowAlways = () => {
    if (allowAlwaysOption) {
      onRespond(approval.id, 'approved', allowAlwaysOption.optionId)
    }
  }

  const handleReject = () => {
    if (rejectOption) {
      onRespond(approval.id, 'rejected', rejectOption.optionId)
    }
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md px-3 py-2 text-xs',
        'bg-warning/5 border border-warning/20',
      )}
      data-testid="approval-card"
    >
      <div className="flex-1 min-w-0">
        <span className="text-muted-foreground">Permission required: </span>
        <span className="text-foreground font-medium">{approval.prompt}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {allowOnceOption && (
          <button
            type="button"
            onClick={handleAllowOnce}
            className={cn(
              'inline-flex items-center gap-1 rounded px-2 py-1',
              'text-xs font-medium',
              'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20',
              'transition-colors',
            )}
            data-testid="approval-allow-btn"
          >
            <CheckIcon className="size-3" aria-hidden="true" />
            Allow
          </button>
        )}
        {allowAlwaysOption && (
          <button
            type="button"
            onClick={handleAllowAlways}
            className={cn(
              'inline-flex items-center gap-1 rounded px-2 py-1',
              'text-xs font-medium',
              'bg-emerald-500/20 text-emerald-700 hover:bg-emerald-500/30',
              'transition-colors',
            )}
          >
            <CheckIcon className="size-3" aria-hidden="true" />
            Always Allow
          </button>
        )}
        {rejectOption && (
          <button
            type="button"
            onClick={handleReject}
            className={cn(
              'inline-flex items-center gap-1 rounded px-2 py-1',
              'text-xs font-medium',
              'bg-destructive/10 text-destructive hover:bg-destructive/20',
              'transition-colors',
            )}
            data-testid="approval-deny-btn"
          >
            <XIcon className="size-3" aria-hidden="true" />
            Deny
          </button>
        )}
      </div>
    </div>
  )
}

interface SessionApprovalListProps {
  chatSessionId: string | null | undefined
}

export function SessionApprovalList({ chatSessionId }: SessionApprovalListProps) {
  const { pending, respond } = useSessionApprovalRequests(chatSessionId)

  if (pending.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2">
      {pending.map(approval => (
        <ApprovalCard
          key={approval.id}
          approval={approval}
          onRespond={respond}
        />
      ))}
    </div>
  )
}
