import { defineTab } from '@cradle/tabs-next'
import { CircleDotIcon } from 'lucide-react'
import { lazy, Suspense } from 'react'

const AwaitsOverview = lazy(() => import('~/features/session-await/awaits-overview').then(m => ({ default: m.AwaitsOverview })))

function AwaitsTabContent({ params: _params }: { params: Record<string, never> }) {
  return (
    <Suspense fallback={null}>
      <AwaitsOverview />
    </Suspense>
  )
}

export const awaitsTab = defineTab({
  type: 'awaits' as const,
  label: 'Awaits',
  icon: CircleDotIcon,
  component: AwaitsTabContent,
})
