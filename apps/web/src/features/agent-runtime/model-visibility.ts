import type { ModelDescriptor } from '~/lib/types'

export const ALL_MODELS_DISABLED_SENTINEL = '__all_disabled__'

export type ModelVisibility
  = | { kind: 'all' }
    | { kind: 'none' }
    | { kind: 'list', ids: Set<string> }

export function readModelVisibility(value: unknown): ModelVisibility {
  if (!Array.isArray(value) || value.length === 0) {
    return { kind: 'all' }
  }

  const ids = value.filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (ids.length === 1 && ids[0] === ALL_MODELS_DISABLED_SENTINEL) {
    return { kind: 'none' }
  }

  return {
    kind: 'list',
    ids: new Set(ids.filter(id => id !== ALL_MODELS_DISABLED_SENTINEL)),
  }
}

export function readConfigModelVisibility(config: Record<string, unknown>): ModelVisibility {
  return readModelVisibility(config.enabledModels)
}

export function modelIsVisible(visibility: ModelVisibility, modelId: string): boolean {
  switch (visibility.kind) {
    case 'all':
      return true
    case 'none':
      return false
    case 'list':
      return visibility.ids.has(modelId)
  }
}

export function filterVisibleModels(models: ModelDescriptor[], visibility: ModelVisibility): ModelDescriptor[] {
  if (visibility.kind === 'all') {
    return models
  }
  if (visibility.kind === 'none') {
    return []
  }
  return models.filter(model => visibility.ids.has(model.id))
}
