import { defineTab } from '@cradle/tabs-next'
import { CheckSquareIcon } from 'lucide-react'
import { lazy, Suspense } from 'react'

const ApprovalInbox = lazy(() => import('~/features/approval/approval-inbox').then(m => ({ default: m.ApprovalInbox })))

function ApprovalsTabContent({ params: _params }: { params: Record<string, never> }) {
  return (
    <Suspense fallback={null}>
      <ApprovalInbox />
    </Suspense>
  )
}

export const approvalsTab = defineTab({
  type: 'approvals' as const,
  label: 'Approvals',
  icon: CheckSquareIcon,
  component: ApprovalsTabContent,
})
