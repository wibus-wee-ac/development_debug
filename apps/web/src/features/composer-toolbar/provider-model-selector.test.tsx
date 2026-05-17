// @vitest-environment jsdom
//
// Input: React Testing Library, ProviderModelSelector, per-profile model map
// Output: Regression tests for provider-owned model lists in composer toolbar menus
// Position: Composer Toolbar test guarding provider hover model ownership

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AgentProfile, ModelDescriptor } from '~/lib/types'

import { ProviderModelSelector } from './provider-model-selector'

vi.mock('~/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>{children}</button>
  ),
}))

vi.mock('~/components/ui/menu', () => ({
  Menu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MenuTrigger: ({
    children,
    render,
  }: {
    children: React.ReactNode
    render: React.ReactElement<React.ButtonHTMLAttributes<HTMLButtonElement>>
  }) => {
    const { children: triggerChildren, ...triggerProps } = render.props
    return (
      <button type="button" {...triggerProps}>
        {triggerChildren ?? children}
      </button>
    )
  },
  MenuPopup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MenuSub: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MenuSubTrigger: ({
    children,
    onClick,
  }: {
    children: React.ReactNode
    onClick?: () => void
  }) => <button type="button" onClick={onClick}>{children}</button>,
  MenuSubPopup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MenuItem: ({
    children,
    disabled,
    onClick,
  }: {
    children: React.ReactNode
    disabled?: boolean
    onClick?: () => void
  }) => <button type="button" disabled={disabled} onClick={onClick}>{children}</button>,
}))

vi.mock('~/features/agent-management/agent-runtime-settings', () => ({
  presetForProfile: (profile: AgentProfile) => ({ id: profile.providerKind }),
  providerVisuals: () => ({
    Icon: () => <span data-testid="provider-icon" />,
  }),
}))

vi.mock('~/lib/cn', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

function profile(input: Pick<AgentProfile, 'id' | 'name' | 'providerKind'>): AgentProfile {
  return {
    ...input,
    enabled: true,
    configJson: '{}',
    credentialRef: null,
    customModels: '[]',
    createdAt: 1,
    updatedAt: 1,
  } as AgentProfile
}

function model(input: Pick<ModelDescriptor, 'id' | 'label' | 'providerKind'>): ModelDescriptor {
  return {
    ...input,
    capabilities: {},
  }
}

describe('providerModelSelector', () => {
  it('renders model lists by provider instead of reusing only the selected provider models', () => {
    const openaiProfile = profile({
      id: 'profile-openai',
      name: 'OpenAI',
      providerKind: 'openai-compatible',
    })
    const anthropicProfile = profile({
      id: 'profile-anthropic',
      name: 'Anthropic',
      providerKind: 'anthropic',
    })

    render(
      <ProviderModelSelector
        profiles={[openaiProfile, anthropicProfile]}
        selectedProfileId={openaiProfile.id}
        selectedModelId="gpt-5.1"
        models={[
          model({ id: 'gpt-5.1', label: 'GPT 5.1', providerKind: 'openai-compatible' }),
        ]}
        modelsByProfileId={{
          [openaiProfile.id]: [
            model({ id: 'gpt-5.1', label: 'GPT 5.1', providerKind: 'openai-compatible' }),
          ],
          [anthropicProfile.id]: [
            model({ id: 'claude-opus-4.5', label: 'Claude Opus 4.5', providerKind: 'anthropic' }),
          ],
        }}
        loadingProfileIds={new Set()}
        thinkingEffort={null}
        isLoadingModels={false}
        onSelectProfile={vi.fn()}
        onSelectModel={vi.fn()}
        onSelectThinkingEffort={vi.fn()}
      />,
    )

    expect(screen.getAllByText('GPT 5.1').length).toBeGreaterThan(0)
    expect(screen.getByText('Claude Opus 4.5')).toBeTruthy()
    expect(screen.queryByText('No models available')).toBeNull()
  })
})
