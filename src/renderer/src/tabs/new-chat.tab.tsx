/* eslint-disable react-refresh/only-export-components */
// Input: defineTab from @cradle/tabs, NewChatPage component, AppLayout
// Output: new-chat tab definition
// Position: Tab type for creating a new chat session

import { defineTab } from '@cradle/tabs'
import { MessageSquarePlusIcon } from 'lucide-react'
import { lazy, Suspense } from 'react'

const NewChatPage = lazy(() => import('@renderer/features/new-chat/new-chat-page').then(m => ({ default: m.NewChatPage })))

function NewChatTabContent({ params: _params }: { params: Record<string, never> }) {
  return (
    <Suspense fallback={null}>
      <NewChatPage />
    </Suspense>
  )
}

export const newChatTab = defineTab({
  type: 'new-chat' as const,
  label: '新建聊天',  icon: MessageSquarePlusIcon,  component: NewChatTabContent,
})
