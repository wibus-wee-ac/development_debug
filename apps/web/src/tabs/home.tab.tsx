/* eslint-disable react-refresh/only-export-components */

import { defineTab } from '@cradle/tabs-next'
import { HomeIcon } from 'lucide-react'
import { lazy, Suspense } from 'react'

// const HomeDashboard = lazy(() => import('~/features/home/home-dashboard').then(m => ({ default: m.HomeDashboard })))
const NewChatPage = lazy(() => import('~/features/new-chat/new-chat-page').then(m => ({ default: m.NewChatPage })))

function NewChatTabContent({ params: _params }: { params: Record<string, never> }) {
  return (
    <Suspense fallback={null}>
      <NewChatPage />
    </Suspense>
  )
}
// function HomeTabContent({ params: _params }: { params: Record<string, never> }) {
//   return (
//     <Suspense fallback={null}>
//       <HomeDashboard />
//     </Suspense>
//   )
// }

export const homeTab = defineTab({
  type: 'home' as const,
  label: '首页',
  icon: HomeIcon,
  pinned: true,
  // component: HomeTabContent,
  component: NewChatTabContent,
})
