import { defineTab } from '@cradle/tabs-next'
import { MessageSquarePlusIcon } from 'lucide-react'
import { lazy } from 'react'

function loadNewChatPage() {
  return import('~/features/new-chat/new-chat-page').then(module => ({ default: module.NewChatPage }))
}

const NewChatPage = lazy(loadNewChatPage)

function NewChatTabContent({ params: _params }: { params: Record<string, never> }) {
  return <NewChatPage />
}

export const newChatTab = defineTab({
  type: 'new-chat' as const,
  label: '新建聊天',
  icon: MessageSquarePlusIcon,
  component: NewChatTabContent,
  preload: () => { void loadNewChatPage() },
})
