import { CheckSquareIcon } from 'lucide-react'

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'

import { ApprovalCard } from './approval-card'
import { useSessionApprovalRequests } from './use-approval'

export function ApprovalInbox() {
  const { pending, respond } = useSessionApprovalRequests(null)

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
      <div className="shrink-0 border-b border-border/50 px-5 py-4">
        <h1 className="text-base font-semibold text-foreground">Approvals</h1>
        <p className="text-xs text-muted-foreground">Pending agent permission requests</p>
      </div>

      {pending.length === 0 ? (
        <Empty className="border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CheckSquareIcon />
            </EmptyMedia>
            <EmptyTitle>No pending approvals</EmptyTitle>
            <EmptyDescription>Agent approval requests will appear here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mx-auto flex max-w-4xl flex-col gap-2">
            {pending.map(approval => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                onRespond={respond}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
