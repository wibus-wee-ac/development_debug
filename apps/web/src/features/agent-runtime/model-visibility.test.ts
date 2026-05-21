import { describe, expect, it } from 'vitest'

import type { ModelDescriptor } from '~/lib/types'

import { ALL_MODELS_DISABLED_SENTINEL, filterVisibleModels, readConfigModelVisibility } from './model-visibility'

const models: ModelDescriptor[] = [
  { id: 'model-a', label: 'Model A', providerKind: 'openai-compatible', capabilities: {} },
  { id: 'model-b', label: 'Model B', providerKind: 'openai-compatible', capabilities: {} },
]

describe('model visibility', () => {
  it('treats a missing or empty enabledModels list as all models visible', () => {
    expect(filterVisibleModels(models, readConfigModelVisibility({})).map(model => model.id)).toEqual(['model-a', 'model-b'])
    expect(filterVisibleModels(models, readConfigModelVisibility({ enabledModels: [] })).map(model => model.id)).toEqual(['model-a', 'model-b'])
  })

  it('supports all-disabled and explicit allow-list states', () => {
    expect(filterVisibleModels(models, readConfigModelVisibility({ enabledModels: [ALL_MODELS_DISABLED_SENTINEL] }))).toEqual([])
    expect(filterVisibleModels(models, readConfigModelVisibility({ enabledModels: ['model-b'] })).map(model => model.id)).toEqual(['model-b'])
  })
})
