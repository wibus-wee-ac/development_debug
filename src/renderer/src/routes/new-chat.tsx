// Input: NewChatPage feature, AppLayout, AppHeader
// Output: /new-chat route — task dispatch page for starting a new agent chat
// Position: Stand-alone route for new chat creation; replaces old slot in index route

import { AppHeader } from '@renderer/components/layout/app-header'
import { AppLayout } from '@renderer/components/layout/app-layout'
import { NewChatPage } from '@renderer/features/new-chat/new-chat-page'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/new-chat')({
  component: NewChat,
})

function NewChat() {
  return (
    <AppLayout
      header={(
        <AppHeader
          trafficLight
          hasAside={false}
          hasPanel={false}
        />
      )}
    >
      <NewChatPage />
    </AppLayout>
  )
}
