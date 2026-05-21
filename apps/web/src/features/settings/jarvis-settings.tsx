import { useMemo } from 'react'

import { useAgentModelMap } from '~/features/agent-runtime/use-agent-models'
import { useAgentProfiles } from '~/features/agent-runtime/use-agent-profiles'
import { filterThinkingOptionsForModel, selectSupportedThinkingValue } from '~/features/composer-toolbar/constants'
import { ProviderModelPicker } from '~/features/composer-toolbar/provider-model-picker'
import type { ThinkingOption } from '~/features/composer-toolbar/provider-model-menu'
import type { JarvisPreferences } from '~/features/system-agent/use-jarvis-preferences'
import { useJarvisPreferences } from '~/features/system-agent/use-jarvis-preferences'

import { SettingsDivider, SettingsRow, SettingsSectionHeader } from './settings-row'

const JARVIS_THINKING_OPTIONS: Array<ThinkingOption<JarvisPreferences['thinkingLevel']>> = [
  { value: 'minimal', label: 'Minimal', description: 'Lowest reasoning budget for direct tasks' },
  { value: 'low', label: 'Low', description: 'Fast responses with light reasoning' },
  { value: 'medium', label: 'Medium', description: 'Balanced reasoning for everyday work' },
  { value: 'high', label: 'High', description: 'Deeper reasoning for complex work' },
  { value: 'xhigh', label: 'Extra High', description: 'Maximum reasoning budget for hard tasks' },
]

export function JarvisSettings() {
  const { prefs, isSaving: saving, savePrefs: save } = useJarvisPreferences()
  const { profiles } = useAgentProfiles()
  const { modelsByProfileId, loadingProfileIds } = useAgentModelMap(profiles)

  const selectedProfile = useMemo(
    () => profiles.find(profile => profile.id === prefs?.profileId) ?? null,
    [prefs?.profileId, profiles],
  )
  const selectedModels = selectedProfile ? modelsByProfileId[selectedProfile.id] ?? [] : []
  const selectedModel = selectedModels.find(model => model.id === prefs?.model) ?? null
  const selectThinkingForModel = (model: typeof selectedModel): JarvisPreferences['thinkingLevel'] =>
    selectSupportedThinkingValue(model, JARVIS_THINKING_OPTIONS, prefs?.thinkingLevel ?? 'medium', 'medium')

  if (!prefs) {
    return null
  }

  return (
    <div className="flex flex-col gap-0">
      <SettingsSectionHeader
        title="Jarvis"
        description="Configure the system assistant that has full awareness of your workspace."
      />
      <SettingsDivider />

      <SettingsRow label="Model" description="Choose Jarvis provider profile, model, and thinking level">
        <ProviderModelPicker
          profiles={profiles}
          selectedProfileId={prefs.profileId}
          selectedModelId={prefs.model ?? null}
          selectedModel={selectedModel}
          modelsByProfileId={modelsByProfileId}
          loadingProfileIds={loadingProfileIds}
          thinkingValue={prefs.thinkingLevel}
          thinkingOptions={JARVIS_THINKING_OPTIONS}
          emptyProfilesLabel="No agent profiles configured"
          emptySelectionLabel="Select a model"
          menuSide="bottom"
          menuAlign="end"
          triggerTestId="jarvis-provider-model-selector"
          disabled={saving}
          getThinkingOptionsForModel={model => filterThinkingOptionsForModel(model, JARVIS_THINKING_OPTIONS)}
          onSelectProfile={(profileId) => {
            const nextModel = (modelsByProfileId[profileId] ?? [])[0] ?? null
            void save({ profileId, model: nextModel?.id, thinkingLevel: selectThinkingForModel(nextModel) })
          }}
          onSelectModel={(model, profileId) => {
            if (!model) {
              return
            }
            const nextModel = (modelsByProfileId[profileId] ?? []).find(item => item.id === model) ?? null
            void save({ profileId, model, thinkingLevel: selectThinkingForModel(nextModel) })
          }}
          onSelectThinking={thinkingLevel => void save({ thinkingLevel })}
        />
      </SettingsRow>
    </div>
  )
}
