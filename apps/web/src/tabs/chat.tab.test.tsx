// @vitest-environment jsdom

import { render, waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { chatTab } from './chat.tab'

const mockedDeps = vi.hoisted(() => ({
  storeState: {
    tabs: [
      {
        id: 'tab-1',
        type: 'chat',
        params: { sessionId: 'abcdef123456' },
        label: 'Chat: abcdef',
      },
      {
        id: 'tab-2',
        type: 'chat',
        params: { sessionId: 'abcdef123456' },
        label: 'Previous title',
      },
      {
        id: 'tab-3',
        type: 'chat',
        params: { sessionId: 'other-session' },
        label: 'Chat: other-',
      },
    ],
    updateTabLabel: vi.fn(),
  },
}))

vi.mock('@cradle/tabs-next', () => ({
  defineTab: <T extends { type: string, label: string | ((params: Record<string, string | undefined>) => string) }>(definition: T) => ({
    ...definition,
    id: definition.type,
    title: definition.label,
  }),
  useTabsContext: () => ({
    store: {
      getState: () => mockedDeps.storeState,
    },
  }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ select }: { select?: (data: Record<string, unknown>) => unknown }) => {
    const session = {
      id: 'abcdef123456',
      title: 'Session Alpha',
      workspaceId: null,
      agentProfileId: null,
      runtimeKind: 'chat',
    }

    return {
      data: select ? select(session) : undefined,
    }
  },
}))

vi.mock('~/api-gen/@tanstack/react-query.gen', () => ({
  getSessionsByIdOptions: () => ({}),
}))

vi.mock('~/api-gen/sdk.gen', () => ({
  getProfilesById: vi.fn(),
  getWorkspacesById: vi.fn(),
}))

vi.mock('~/components/layout/use-layout-slots', () => ({
  useRegisterLayoutSlots: vi.fn(),
}))

vi.mock('~/features/composer-toolbar', () => ({
  ComposerToolbar: () => null,
  useComposerState: () => ({
    selection: {
      modelId: null,
      thinkingEffort: null,
    },
  }),
}))

vi.mock('~/features/tui/shell-view', () => ({
  ShellView: () => null,
}))

vi.mock('~/features/tui/tui-view', () => ({
  TuiView: () => null,
}))

vi.mock('~/features/chat/chat-view', () => ({
  ChatView: () => null,
}))

vi.mock('~/store/layout', () => ({
  useLayoutStore: (selector: (state: { bottomPanelOpen: boolean, setBottomPanelOpen: () => void }) => unknown) =>
    selector({
      bottomPanelOpen: false,
      setBottomPanelOpen: vi.fn(),
    }),
}))

describe('chatTab', () => {
  beforeEach(() => {
    mockedDeps.storeState.updateTabLabel.mockClear()
  })

  it('uses a generic fallback label instead of exposing the session id', () => {
    expect(chatTab.title).toBe('Chat')
  })

  it('replaces legacy generated labels and applies the loaded session title to matching chat tabs', async () => {
    const ChatTabContent = chatTab.component as ComponentType<{
      params: { sessionId: string }
    }>

    render(<ChatTabContent params={{ sessionId: 'abcdef123456' }} />)

    await waitFor(() => {
      expect(mockedDeps.storeState.updateTabLabel).toHaveBeenCalledWith('tab-1', 'Chat')
      expect(mockedDeps.storeState.updateTabLabel).toHaveBeenCalledWith('tab-1', 'Session Alpha')
      expect(mockedDeps.storeState.updateTabLabel).toHaveBeenCalledWith('tab-2', 'Session Alpha')
    })

    expect(mockedDeps.storeState.updateTabLabel).not.toHaveBeenCalledWith('tab-3', 'Session Alpha')
  })
})
