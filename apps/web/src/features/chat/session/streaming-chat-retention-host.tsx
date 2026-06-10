import { useQuery } from '@tanstack/react-query'
import { shallow } from 'zustand/shallow'

import { getSessionsByIdOptions } from '~/api-gen/@tanstack/react-query.gen'
import { chatSelectors, useChatStore } from '~/store/chat'
import { chatSessionIdForSurface } from '~/navigation/surface-identity'
import { useSurfaceStore } from '~/navigation/surface-store'

import type { ChatSessionFrameDescriptor } from './chat-session-frame-host'
import { ChatSessionFrameHost } from './chat-session-frame-host'

function useStreamingSessionIds(): string[] {
  return useChatStore((state) => {
    const sessionIds = Array.from(state.messagesMap.keys())
      .filter(sessionId => chatSelectors.isSessionStreaming(sessionId)(state))
      .sort()
    return sessionIds
  }, shallow)
}

function useActiveChatSessionId(): string | null {
  return useSurfaceStore((state) => {
    const activeSurface = state.surfaces.find(surface => surface.id === state.activeSurfaceId)
    return chatSessionIdForSurface(activeSurface)
  })
}

function RetainedStreamingChatSession({ sessionId }: { sessionId: string }) {
  const { data: session } = useQuery({
    ...getSessionsByIdOptions({ path: { id: sessionId } }),
    enabled: !!sessionId,
    staleTime: 60_000,
  })

  const descriptor: ChatSessionFrameDescriptor = {
    sessionId,
    sessionProviderTargetId: session?.providerTargetId ?? null,
    sessionModelId: session?.modelId ?? null,
    runtimeKind: session?.runtimeKind,
    workspaceId: session?.workspaceId ?? null,
    agentId: session?.agentId ?? null,
  }

  return <ChatSessionFrameHost activeSession={descriptor} active={false} />
}

export function StreamingChatRetentionHost() {
  const streamingSessionIds = useStreamingSessionIds()
  const activeChatSessionId = useActiveChatSessionId()
  const retainedSessionIds = streamingSessionIds.filter(sessionId => sessionId !== activeChatSessionId)

  if (retainedSessionIds.length === 0) {
    return null
  }

  return (
    <div
      aria-hidden="true"
      className="fixed left-0 top-0 h-0 w-0 overflow-hidden"
      data-streaming-chat-retention-host=""
    >
      {retainedSessionIds.map(sessionId => (
        <RetainedStreamingChatSession key={sessionId} sessionId={sessionId} />
      ))}
    </div>
  )
}
