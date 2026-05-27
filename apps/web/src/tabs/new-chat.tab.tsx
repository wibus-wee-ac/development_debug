/* eslint-disable react-refresh/only-export-components */

import { defineTab } from '@cradle/tabs-next'
import { MessageSquarePlusIcon } from 'lucide-react'
import { lazy } from 'react'

import { loadNewChatPage, preloadNewChatPage } from '~/features/new-chat/new-chat-page-loader'

const NewChatPage = lazy(loadNewChatPage)

function NewChatTabContent({ params: _params }: { params: Record<string, never> }) {
  return <NewChatPage />
}

export const newChatTab = defineTab({
  type: 'new-chat' as const,
  label: '新建聊天',
  icon: MessageSquarePlusIcon,
  component: NewChatTabContent,
  preload: preloadNewChatPage,
})
