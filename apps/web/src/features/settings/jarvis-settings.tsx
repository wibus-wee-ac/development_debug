import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useAgentModelMap } from '~/features/agent-runtime/use-agent-models'
import { useAgentProfiles } from '~/features/agent-runtime/use-agent-profiles'
import { filterThinkingOptionsForModel, selectSupportedThinkingValue } from '~/features/composer-toolbar/constants'
import { ProviderModelPicker } from '~/features/composer-toolbar/provider-model-picker'
import type { ThinkingOption } from '~/features/composer-toolbar/provider-model-menu'
import type { JarvisPreferences } from '~/features/system-agent/use-jarvis-preferences'
import { useJarvisPreferences } from '~/features/system-agent/use-jarvis-preferences'

import { SettingsDivider, SettingsRow, SettingsSectionHeader } from './settings-row'

const JARVIS_THINKING_LEVELS: Array<JarvisPreferences['thinkingLevel']> = ['minimal', 'low', 'medium', 'high', 'xhigh']

type SettingsKey = keyof typeof import('~/locales/default').default.settings

const jarvisThinkingLabelKeys = {
  minimal: 'jarvis.thinking.minimal.label',
  low: 'jarvis.thinking.low.label',
  medium: 'jarvis.thinking.medium.label',
  high: 'jarvis.thinking.high.label',
  xhigh: 'jarvis.thinking.xhigh.label',
} satisfies Record<JarvisPreferences['thinkingLevel'], SettingsKey>

const jarvisThinkingDescriptionKeys = {
  minimal: 'jarvis.thinking.minimal.description',
  low: 'jarvis.thinking.low.description',
  medium: 'jarvis.thinking.medium.description',
  high: 'jarvis.thinking.high.description',
  xhigh: 'jarvis.thinking.xhigh.description',
} satisfies Record<JarvisPreferences['thinkingLevel'], SettingsKey>

export function JarvisSettings() {
  const { t } = useTranslation('settings')
  const { prefs, isSuccess: prefsReady, isSaving: saving, savePrefs: save } = useJarvisPreferences()
  const { profiles, isSuccess: profilesReady } = useAgentProfiles()
  const selectedProfile = useMemo(
    () => profiles.find(profile => profile.id === prefs?.profileId) ?? null,
    [prefs?.profileId, profiles],
  )
  const initialModelProfileIds = useMemo(() => [prefs?.profileId ?? null], [prefs?.profileId])
  const { modelsByProfileId, loadingProfileIds, successfulProfileIds, requestProfileModels } = useAgentModelMap(
    profiles,
    initialModelProfileIds,
  )
  const selectedModels = selectedProfile ? modelsByProfileId[selectedProfile.id] ?? [] : []
  const selectedModel = selectedModels.find(model => model.id === prefs?.model) ?? null
  const selectedProfileModelsReady = !selectedProfile || !selectedProfile.enabled || successfulProfileIds.has(selectedProfile.id)
  const settingsJarvisReady = prefsReady && profilesReady && selectedProfileModelsReady
  const thinkingOptions: Array<ThinkingOption<JarvisPreferences['thinkingLevel']>> = useMemo(() => JARVIS_THINKING_LEVELS.map(value => ({
    value,
    label: t(jarvisThinkingLabelKeys[value]),
    description: t(jarvisThinkingDescriptionKeys[value]),
  })), [t])
  const selectThinkingForModel = (model: typeof selectedModel): JarvisPreferences['thinkingLevel'] =>
    selectSupportedThinkingValue(model, thinkingOptions, prefs?.thinkingLevel ?? 'medium', 'medium')

  if (!prefs) {
    return null
  }

  return (
    <div
      className="flex flex-col gap-0"
      data-testid="jarvis-settings"
      data-settings-jarvis-ready={settingsJarvisReady ? 'true' : 'false'}
    >
      <SettingsSectionHeader
        title={t('jarvis.page.title')}
        description={t('jarvis.page.description')}
      />
      <SettingsDivider />

      <SettingsRow label={t('jarvis.model.label')} description={t('jarvis.model.description')}>
        <ProviderModelPicker
          profiles={profiles}
          selectedProfileId={prefs.profileId}
          selectedModelId={prefs.model ?? null}
          selectedModel={selectedModel}
          modelsByProfileId={modelsByProfileId}
          loadingProfileIds={loadingProfileIds}
          thinkingValue={prefs.thinkingLevel}
          thinkingOptions={thinkingOptions}
          emptyProfilesLabel={t('jarvis.model.emptyProfiles')}
          emptySelectionLabel={t('jarvis.model.emptySelection')}
          menuSide="bottom"
          menuAlign="end"
          triggerTestId="jarvis-provider-model-selector"
          disabled={saving}
          getThinkingOptionsForModel={model => filterThinkingOptionsForModel(model, thinkingOptions)}
          onRequestProfileModels={requestProfileModels}
          onSelectProfile={(profileId) => {
            requestProfileModels(profileId)
            const nextModel = (modelsByProfileId[profileId] ?? [])[0] ?? null
            if (!nextModel) {
              void save({ profileId, model: undefined })
              return
            }
            void save({ profileId, model: nextModel.id, thinkingLevel: selectThinkingForModel(nextModel) })
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
