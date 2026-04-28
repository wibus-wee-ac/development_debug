/* eslint-disable react-refresh/only-export-components */
// Input: defineTab from @cradle/tabs, ChatView component, ipc
// Output: chat tab definition with session message loader
// Position: Tab type for chat sessions

import { defineTab } from '@cradle/tabs'
import type { ChatMessageRow } from '@renderer/features/chat/use-chat-session'
import { ipc } from '@renderer/lib/ipc'
import { LoaderCircleIcon } from 'lucide-react'
import { lazy, Suspense } from 'react'

const ChatView = lazy(() => import('@renderer/features/chat/chat-view').then(m => ({ default: m.ChatView })))

function ChatTabContent({ params, loaderData }: { params: { sessionId: string }, loaderData?: ChatMessageRow[] }) {
  return (
    <Suspense fallback={null}>
      <ChatView sessionId={params.sessionId} initialMessageRows={loaderData} />
    </Suspense>
  )
}

export const chatTab = defineTab({
  type: 'chat' as const,
  label: (params: { sessionId: string }) => `Chat: ${params.sessionId.slice(0, 8)}`,
  component: ChatTabContent,
  loader: async (params: { sessionId: string }) => {
    if (!ipc) {
      return []
    }
    return ipc.chat.getMessages(params.sessionId)
  },
  loaderFallback: (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <LoaderCircleIcon style={{ width: 16, height: 16, animation: 'spin 1s linear infinite', opacity: 0.4 }} />
    </div>
  ),
  serialize: params => params.sessionId,
  deserialize: path => path ? { sessionId: path } : null,
})
