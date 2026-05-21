// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Agent, AgentProfile, ModelDescriptor } from '~/lib/types'
import { useNewChatStore } from '~/store/new-chat'

import { useComposerState } from './use-composer-state'

const mockData = vi.hoisted(() => ({
  agents: [] as Agent[],
  profiles: [] as AgentProfile[],
  modelsByProfileId: {} as Record<string, ModelDescriptor[]>,
}))

vi.mock('~/features/agent-runtime/use-agents', () => ({
  useAgents: () => ({
    agents: mockData.agents,
    isLoading: false,
  }),
}))

vi.mock('~/features/agent-runtime/use-agent-profiles', () => ({
  useAgentProfiles: () => ({
    profiles: mockData.profiles,
    isLoading: false,
    refetch: vi.fn(),
  }),
}))

vi.mock('~/features/agent-runtime/use-agent-models', () => ({
  useAgentModelMap: () => ({
    modelsByProfileId: mockData.modelsByProfileId,
    loadingProfileIds: new Set<string>(),
  }),
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

function model(input: Pick<ModelDescriptor, 'id' | 'label' | 'providerKind'> & { capabilities?: ModelDescriptor['capabilities'] }): ModelDescriptor {
  return {
    id: input.id,
    label: input.label,
    providerKind: input.providerKind,
    capabilities: input.capabilities ?? {},
  }
}

function agent(input: Pick<Agent, 'id' | 'name' | 'runtimeKind'>): Agent {
  return {
    ...input,
    enabled: true,
  } as Agent
}

describe('useComposerState', () => {
  beforeEach(() => {
    mockData.agents = []
    mockData.profiles = []
    mockData.modelsByProfileId = {}
    useNewChatStore.setState({
      lastRuntimeKind: null,
      lastCliTuiAgentId: null,
      lastAgentProfileId: null,
      lastModelByProfile: {},
      lastThinkingEffort: null,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('selects and remembers the owner profile when a model is selected directly', () => {
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

    mockData.profiles = [openaiProfile, anthropicProfile]
    mockData.modelsByProfileId = {
      [openaiProfile.id]: [
        model({ id: 'gpt-5.1', label: 'GPT 5.1', providerKind: 'openai-compatible' }),
      ],
      [anthropicProfile.id]: [
        model({ id: 'claude-opus-4.5', label: 'Claude Opus 4.5', providerKind: 'anthropic' }),
      ],
    }
    useNewChatStore.setState({ lastAgentProfileId: openaiProfile.id })

    const { result } = renderHook(() => useComposerState({ context: 'new-chat' }))

    act(() => {
      result.current.setModelId('claude-opus-4.5', anthropicProfile.id)
    })

    expect(result.current.selection).toMatchObject({
      profileId: anthropicProfile.id,
      modelId: 'claude-opus-4.5',
    })
    expect(useNewChatStore.getState()).toMatchObject({
      lastAgentProfileId: anthropicProfile.id,
      lastModelByProfile: {
        [anthropicProfile.id]: 'claude-opus-4.5',
      },
    })
  })

  it('restores runtime, CLI TUI agent, and thinking effort preferences', () => {
    const cliAgent = agent({
      id: 'agent-cli',
      name: 'CLI Agent',
      runtimeKind: 'cli-tui',
    })
    const openaiProfile = profile({
      id: 'profile-openai',
      name: 'OpenAI',
      providerKind: 'openai-compatible',
    })

    mockData.agents = [cliAgent]
    mockData.profiles = [openaiProfile]
    mockData.modelsByProfileId = {
      [openaiProfile.id]: [
        model({
          id: 'gpt-5.1',
          label: 'GPT 5.1',
          providerKind: 'openai-compatible',
          capabilities: { reasoning: true },
        }),
      ],
    }
    useNewChatStore.setState({
      lastRuntimeKind: 'cli-tui',
      lastCliTuiAgentId: cliAgent.id,
      lastAgentProfileId: openaiProfile.id,
      lastThinkingEffort: 'high',
    })

    const { result, rerender } = renderHook(() => useComposerState({ context: 'new-chat' }))

    expect(result.current.selection).toMatchObject({
      runtimeKind: 'cli-tui',
      agentId: cliAgent.id,
      thinkingEffort: null,
    })

    act(() => {
      result.current.setRuntimeKind('standard')
    })
    rerender()

    expect(result.current.selection).toMatchObject({
      runtimeKind: 'standard',
      profileId: openaiProfile.id,
      thinkingEffort: 'high',
    })
  })
})
