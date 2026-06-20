import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ProviderRequest } from '../provider-contracts/types'
import { ProviderCatalog } from './catalog'

function getRequestUrl(input: Parameters<typeof fetch>[0]): string {
  return new Request(input).url
}

describe('ProviderCatalog', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lists Universal models from the OpenAI-compatible endpoint only', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = getRequestUrl(input)
      if (url !== 'https://openai.example.test/v1/models') {
        throw new Error(`Unexpected Universal model list request: ${url}`)
      }

      expect(init?.headers).toMatchObject({ Authorization: 'Bearer sk-universal' })
      return new Response(JSON.stringify({ data: [{ id: 'gpt-universal' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const provider = new ProviderCatalog().get('universal')
    if (!provider) {
      throw new Error('Universal provider is not registered')
    }

    const request: ProviderRequest = {
      providerKind: 'universal',
      label: 'Universal',
      configJson: JSON.stringify({
        openaiBaseUrl: 'https://openai.example.test/v1',
        anthropicBaseUrl: 'https://anthropic.example.test/v1',
      }),
      secretRef: 'secret-universal',
      profileId: null,
      providerTargetKind: null,
      providerTargetId: null,
    }

    await expect(provider.listModels(request, {
      readSecret: (secretRef) => {
        expect(secretRef).toBe('secret-universal')
        return 'sk-universal'
      },
    })).resolves.toEqual([
      {
        id: 'gpt-universal',
        label: 'gpt-universal',
        providerKind: 'universal',
        capabilities: {},
      },
    ])

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
