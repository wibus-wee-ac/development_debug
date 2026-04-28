/* eslint-disable react-refresh/only-export-components */
// Input: defineTab from @cradle/tabs, ChatView component, AppLayout
// Output: chat tab definition
// Position: Tab type for chat sessions

import { defineTab } from '@cradle/tabs'
import { lazy, Suspense } from 'react'

const ChatView = lazy(() => import('@renderer/features/chat/chat-view').then(m => ({ default: m.ChatView })))

function ChatTabContent({ params }: { params: { sessionId: string } }) {
  return (
    <Suspense fallback={null}>
      <ChatView sessionId={params.sessionId} />
    </Suspense>
  )
}

export const chatTab = defineTab({
  type: 'chat' as const,
  label: (params: { sessionId: string }) => `Chat: ${params.sessionId.slice(0, 8)}`,
  component: ChatTabContent,
  serialize: params => params.sessionId,
  deserialize: path => path ? { sessionId: path } : null,
})
