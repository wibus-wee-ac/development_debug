// @vitest-environment jsdom
//
// Input: React Testing Library, mocked CapsuleComposer dependencies, and CapsuleComposer
// Output: Regression tests for capsule composer send button accessibility and callback wiring
// Position: Workspace detail feature test guarding the overview capsule composer action

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CapsuleComposer } from './capsule-composer'

const mockedDeps = vi.hoisted(() => ({
  composerState: {
    selection: {
      agentId: null,
      profileId: 'profile-1',
      modelId: 'model-1',
      thinkingEffort: 'medium',
      runtimeKind: 'standard',
    },
    setAgentId: vi.fn(),
    setProfileId: vi.fn(),
    setModelId: vi.fn(),
    setThinkingEffort: vi.fn(),
    setRuntimeKind: vi.fn(),
    agents: [],
    profiles: [{
      id: 'profile-1',
      name: 'Default Profile',
      enabled: true,
      providerKind: 'openai-compatible',
      configJson: '{}',
      credentialRef: null,
      customModels: '[]',
      createdAt: 1,
      updatedAt: 1,
    }],
    models: [{
      id: 'model-1',
      label: 'Default Model',
      providerKind: 'openai-compatible',
      capabilities: { reasoning: true },
    }],
    modelsByProfileId: {},
    loadingProfileIds: new Set<string>(),
    isLoadingModels: false,
    effectiveAgent: null,
    effectiveProfile: {
      id: 'profile-1',
      name: 'Default Profile',
      enabled: true,
      providerKind: 'openai-compatible',
      configJson: '{}',
      credentialRef: null,
      customModels: '[]',
      createdAt: 1,
      updatedAt: 1,
    },
    effectiveModel: {
      id: 'model-1',
      label: 'Default Model',
      providerKind: 'openai-compatible',
      capabilities: { reasoning: true },
    },
  },
}))

vi.mock('~/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>{children}</button>
  ),
}))

vi.mock('~/features/chat/mention-panel', () => ({
  MentionPanel: () => <div data-testid="mock-mention-panel" />,
}))

vi.mock('~/features/composer-toolbar', () => ({
  ComposerToolbar: () => <div data-testid="mock-composer-toolbar" />,
  useComposerState: () => mockedDeps.composerState,
}))

vi.mock('~/features/workspace/use-workspace-files', () => ({
  useWorkspaceFiles: () => ({ files: [] }),
}))

vi.mock('~/lib/cn', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

describe('CapsuleComposer', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('exposes a named send control and disables it while empty', () => {
    render(<CapsuleComposer workspaceId="workspace-1" onSend={vi.fn()} />)

    const sendButton = screen.getByRole('button', { name: 'Send message' })

    expect((sendButton as HTMLButtonElement).disabled).toBe(true)
    expect(sendButton.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('keeps the named send control wired to capsule submission', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined)

    render(<CapsuleComposer workspaceId="workspace-1" onSend={onSend} />)

    fireEvent.change(screen.getByPlaceholderText('在此工作区开始新对话...'), {
      target: { value: 'Summarize this workspace' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith('Summarize this workspace', {
        runtimeKind: 'standard',
        agentProfileId: 'profile-1',
        modelId: 'model-1',
        thinkingEffort: 'medium',
      })
    })
  })
})
