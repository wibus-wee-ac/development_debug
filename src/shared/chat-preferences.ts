// Input: ACP session-like state and config option shapes from shared type definitions
// Output: Chat preference helpers for persisting and applying model/thinking selections
// Position: Shared utility for global chat defaults applied onto ACP session state

export interface SessionModelLike {
  currentModelId?: string | null
  availableModels?: Array<{ modelId: string, name?: string }>
}

export interface SessionConfigSelectOptionLike {
  value: string
  name?: string
}

export interface SessionConfigSelectGroupLike {
  name?: string
  options: SessionConfigSelectOptionLike[]
}

export interface SessionConfigOptionLike {
  id: string
  name?: string
  description?: string | null
  category?: string | null
  type: 'select' | 'boolean' | string
  currentValue?: string | boolean
  options?: Array<SessionConfigSelectOptionLike | SessionConfigSelectGroupLike>
}

export interface SessionStateLike {
  models: SessionModelLike | null
  configOptions: SessionConfigOptionLike[]
}

export interface StoredChatPreferences {
  modelId: string | null
  configSelections: Record<string, string | boolean>
}

export function buildStoredChatPreferences(state: SessionStateLike | null): StoredChatPreferences {
  return {
    modelId: state?.models?.currentModelId ?? null,
    configSelections: Object.fromEntries(
      (state?.configOptions ?? [])
        .filter(hasPersistableValue)
        .map(option => [option.id, option.currentValue]),
    ),
  }
}

export function buildStoredChatPreferencesFromSnapshot(args: {
  modelId: string | null
  configSnapshot: string | null
}): StoredChatPreferences {
  const { modelId, configSnapshot } = args
  const parsedOptions = parseConfigSnapshot(configSnapshot)

  return {
    modelId,
    configSelections: Object.fromEntries(
      parsedOptions.filter(hasPersistableValue).map(option => [option.id, option.currentValue]),
    ),
  }
}

export function mergeChatPreferencesWithState(
  preferences: StoredChatPreferences,
  state: SessionStateLike | null,
): StoredChatPreferences {
  return {
    modelId: state?.models?.currentModelId ?? preferences.modelId,
    configSelections: {
      ...preferences.configSelections,
      ...Object.fromEntries(
        (state?.configOptions ?? [])
          .filter(hasPersistableValue)
          .map(option => [option.id, option.currentValue]),
      ),
    },
  }
}

export async function applyStoredChatPreferences(args: {
  preferences: StoredChatPreferences | null
  state: SessionStateLike | null
  setModel: (modelId: string) => Promise<void>
  setConfigOption: (configId: string, value: string | boolean) => Promise<void>
}): Promise<void> {
  const { preferences, state, setModel, setConfigOption } = args
  if (!preferences || !state) {
    return
  }

  const availableModelIds = new Set(
    state.models?.availableModels?.map(model => model.modelId) ?? [],
  )
  if (
    preferences.modelId
    && preferences.modelId !== state.models?.currentModelId
    && availableModelIds.has(preferences.modelId)
  ) {
    await setModel(preferences.modelId)
  }

  for (const option of state.configOptions) {
    if (!hasPersistableValue(option)) {
      continue
    }
    const preferredValue = preferences.configSelections[option.id]
    if (preferredValue === undefined || preferredValue === option.currentValue) {
      continue
    }
    if (!isAllowedOptionValue(option, preferredValue)) {
      continue
    }
    await setConfigOption(option.id, preferredValue)
  }
}

function hasPersistableValue(
  option: SessionConfigOptionLike,
): option is SessionConfigOptionLike & { currentValue: string | boolean } {
  return typeof option.currentValue === 'string' || typeof option.currentValue === 'boolean'
}

function isAllowedOptionValue(option: SessionConfigOptionLike, value: string | boolean): boolean {
  if (option.type === 'boolean') {
    return typeof value === 'boolean'
  }
  if (option.type !== 'select' || typeof value !== 'string') {
    return false
  }
  return flattenOptionValues(option.options).includes(value)
}

function flattenOptionValues(options: SessionConfigOptionLike['options']): string[] {
  if (!options) {
    return []
  }
  return options.flatMap((option) => {
    if ('value' in option) {
      return [option.value]
    }
    return option.options.map(groupOption => groupOption.value)
  })
}

function parseConfigSnapshot(configSnapshot: string | null): SessionConfigOptionLike[] {
  if (!configSnapshot) {
    return []
  }

  try {
    const parsed = JSON.parse(configSnapshot)
    return Array.isArray(parsed) ? (parsed as SessionConfigOptionLike[]) : []
  }
 catch {
    return []
  }
}
