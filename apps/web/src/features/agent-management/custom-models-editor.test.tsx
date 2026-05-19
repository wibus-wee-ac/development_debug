// @vitest-environment jsdom
//
// Input: React Testing Library, mocked provider model lookup API, CustomModelsEditor
// Output: Regression coverage for custom model action labels and add-model fallback behavior
// Position: Agent Management feature test for provider custom model editing UI

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CustomModelsEditor } from './custom-models-editor'

const apiMocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  search: vi.fn(),
}))

vi.mock('~/api-gen/sdk.gen', () => ({
  postProvidersModelLookup: apiMocks.lookup,
  postProvidersModelSearch: apiMocks.search,
}))

describe('CustomModelsEditor', () => {
  it('labels icon-only model actions with the target model id', () => {
    render(
      <CustomModelsEditor
        profileId="profile-1"
        models={[
          {
            id: 'custom-model',
            label: 'Custom Model',
            capabilities: {},
          },
        ]}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Match custom-model from models.dev' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove custom-model' })).toBeTruthy()
  })

  it('adds a manual model id when lookup returns no metadata', async () => {
    apiMocks.lookup.mockResolvedValueOnce({ data: null })
    const onChange = vi.fn()

    const { container } = render(
      <CustomModelsEditor
        profileId="profile-1"
        models={[]}
        onChange={onChange}
      />,
    )

    fireEvent.change(within(container).getByPlaceholderText('e.g. claude-sonnet-4-20250514'), {
      target: { value: 'custom-model' },
    })
    fireEvent.click(within(container).getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([
        {
          id: 'custom-model',
          label: 'custom-model',
          capabilities: {},
        },
      ])
    })
  })
})
