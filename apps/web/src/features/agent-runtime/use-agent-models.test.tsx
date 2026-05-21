// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentProfile, ModelDescriptor } from '~/lib/types'

import { useAgentModels } from './use-agent-models'

const getProfilesByIdMock = vi.fn()
const getProvidersByProfileIdModelsCacheMock = vi.fn()
const postProvidersModelsMock = vi.fn()

vi.mock('~/api-gen/sdk.gen', () => ({
  getProfilesById: (...args: unknown[]) => getProfilesByIdMock(...args),
  getProvidersByProfileIdModelsCache: (...args: unknown[]) => getProvidersByProfileIdModelsCacheMock(...args),
  postProvidersModels: (...args: unknown[]) => postProvidersModelsMock(...args),
}))

function profile(input: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'profile-1',
    name: 'DeepSeek',
    providerKind: 'openai-compatible',
    enabled: true,
    configJson: '{}',
    credentialRef: 'secret-1',
    customModels: '[]',
    createdAt: 1,
    updatedAt: 1,
    ...input,
  } as AgentProfile
}

function model(input: Partial<ModelDescriptor> = {}): ModelDescriptor {
  return {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    providerKind: 'openai-compatible',
    capabilities: {},
    ...input,
  } as ModelDescriptor
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useAgentModels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('falls back to cached profile models when fresh provider listing fails', async () => {
    const cachedModel = model()

    getProfilesByIdMock.mockResolvedValue({ data: profile() })
    postProvidersModelsMock.mockRejectedValue(new Error('provider models unavailable'))
    getProvidersByProfileIdModelsCacheMock.mockResolvedValue({
      data: {
        models: [cachedModel],
        cached: true,
        stale: true,
      },
    })

    const { result } = renderHook(() => useAgentModels('profile-1'), { wrapper })

    await waitFor(() => {
      expect(result.current.models.map(item => item.id)).toEqual(['deepseek-v4-pro'])
    })
    expect(postProvidersModelsMock).toHaveBeenCalledWith(expect.objectContaining({ throwOnError: true }))
    expect(getProvidersByProfileIdModelsCacheMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { profileId: 'profile-1' },
      throwOnError: true,
    }))
  })

  it('still applies profile model visibility to cached fallback models', async () => {
    getProfilesByIdMock.mockResolvedValue({
      data: profile({ configJson: JSON.stringify({ enabledModels: ['deepseek-v4-flash'] }) }),
    })
    postProvidersModelsMock.mockRejectedValue(new Error('provider models unavailable'))
    getProvidersByProfileIdModelsCacheMock.mockResolvedValue({
      data: {
        models: [
          model({ id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' }),
          model({ id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' }),
        ],
        cached: true,
        stale: true,
      },
    })

    const { result } = renderHook(() => useAgentModels('profile-1'), { wrapper })

    await waitFor(() => {
      expect(result.current.models.map(item => item.id)).toEqual(['deepseek-v4-flash'])
    })
  })
})
