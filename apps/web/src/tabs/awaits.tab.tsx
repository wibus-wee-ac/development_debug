import { defineTab } from '@cradle/tabs-next'
import { CircleDotIcon } from 'lucide-react'
import { lazy } from 'react'

function loadAwaitsOverview() {
  return import('~/features/session-await/awaits-overview').then(module => ({ default: module.AwaitsOverview }))
}

const AwaitsOverview = lazy(loadAwaitsOverview)

function AwaitsTabContent({ params: _params }: { params: Record<string, never> }) {
  return <AwaitsOverview />
}

export const awaitsTab = defineTab({
  type: 'awaits' as const,
  label: 'Awaits',
  icon: CircleDotIcon,
  component: AwaitsTabContent,
  preload: () => { void loadAwaitsOverview() },
  keepAlive: 'always',
})
