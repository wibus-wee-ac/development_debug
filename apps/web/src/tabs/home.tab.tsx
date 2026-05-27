/* eslint-disable react-refresh/only-export-components */

import { defineTab } from '@cradle/tabs-next'
import { HomeIcon } from 'lucide-react'
import { lazy } from 'react'

import { loadNewChatPage, preloadNewChatPage } from '~/features/new-chat/new-chat-page-loader'

// const HomeDashboard = lazy(() => import('~/features/home/home-dashboard').then(m => ({ default: m.HomeDashboard })))
const NewChatPage = lazy(loadNewChatPage)

function NewChatTabContent({ params: _params }: { params: Record<string, never> }) {
  return <NewChatPage />
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
  preload: preloadNewChatPage,
})
