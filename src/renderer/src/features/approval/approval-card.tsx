// Input: useSessionApprovalRequests hook, PendingApproval data
// Output: Inline approval card rendered inside chat message area
// Position: Renderer approval feature — user-facing approval interaction component

import { cn } from '@renderer/lib/utils'
import type { ApprovalRequestedPayload } from '@shared/approval-events'
import { CheckIcon, XIcon } from 'lucide-react'

import { useSessionApprovalRequests } from './use-approval'

interface ApprovalCardProps {
  approval: ApprovalRequestedPayload
  onRespond: (approvalId: string, decision: 'approved' | 'rejected', selectedOptionId: string) => void
}

function ApprovalCard({ approval, onRespond }: ApprovalCardProps) {
  const allowOptions = approval.options.filter(o => o.description === 'allow_once' || o.description === 'allow_always')
  const rejectOptions = approval.options.filter(o => o.description === 'reject_once' || o.description === 'reject_always')

  const handleAllow = () => {
    const option = allowOptions[0]
    if (option) {
      onRespond(approval.id, 'approved', option.optionId)
    }
  }

  const handleReject = () => {
    const option = rejectOptions[0]
    if (option) {
      onRespond(approval.id, 'rejected', option.optionId)
    }
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md px-3 py-2 text-xs',
        'bg-warning/5 border border-warning/20',
      )}
    >
      <div className="flex-1 min-w-0">
        <span className="text-muted-foreground">Permission required: </span>
        <span className="text-foreground font-medium">{approval.prompt}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {allowOptions.length > 0 && (
          <button
            type="button"
            onClick={handleAllow}
            className={cn(
              'inline-flex items-center gap-1 rounded px-2 py-1',
              'text-xs font-medium',
              'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20',
              'transition-colors',
            )}
          >
            <CheckIcon className="size-3" aria-hidden="true" />
            {allowOptions[0].label}
          </button>
        )}
        {rejectOptions.length > 0 && (
          <button
            type="button"
            onClick={handleReject}
            className={cn(
              'inline-flex items-center gap-1 rounded px-2 py-1',
              'text-xs font-medium',
              'bg-destructive/10 text-destructive hover:bg-destructive/20',
              'transition-colors',
            )}
          >
            <XIcon className="size-3" aria-hidden="true" />
            {rejectOptions[0].label}
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
