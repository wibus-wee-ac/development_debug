import { CheckSquareIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'
import { markCradlePerformance, measureCradlePerformance } from '~/lib/perf-monitor'

import { ApprovalCard } from './approval-card'
import { useSessionApprovalRequests } from './use-approval'

export function ApprovalInbox() {
  const firstRenderedRef = useRef(false)
  const { pending, respond } = useSessionApprovalRequests(null)

  useEffect(() => {
    if (firstRenderedRef.current) {
      return
    }

    firstRenderedRef.current = true
    markCradlePerformance('cradle:first-approvals-rendered')
    measureCradlePerformance(
      'cradle:approvals-first-render',
      'cradle:approvals-render-requested',
      'cradle:first-approvals-rendered',
    )
  }, [])

  return (
    <div
      className="flex h-full min-w-0 flex-col overflow-hidden bg-background"
      data-testid="approval-inbox"
      data-approvals-ready="true"
    >
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
