import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useProviderTargetModelMap } from '~/features/agent-runtime/use-agent-models'
import { useProviderTargets } from '~/features/agent-runtime/use-provider-targets'
import { listRuntimeCatalogForSurface, useRuntimeCatalog } from '~/features/agent-runtime/use-runtime-catalog'
import { listSelectableComposerProfiles } from '~/features/composer-toolbar/composer-profile-selection'
import { filterThinkingOptionsForModel, selectSupportedThinkingValue } from '~/features/composer-toolbar/constants'
import type { ThinkingOption } from '~/features/composer-toolbar/provider-model-menu'
import { ProviderModelPicker } from '~/features/composer-toolbar/provider-model-picker'
import { RuntimeSelector } from '~/features/composer-toolbar/runtime-selector'
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
  const { providerOptions, isSuccess: providerTargetsReady } = useProviderTargets()
  const { runtimes } = useRuntimeCatalog()
  const runtimeKind = prefs?.runtimeKind ?? 'jar-core'
  const runtimeOptions = useMemo(
    () => listRuntimeCatalogForSurface(runtimes, 'jarvis').map(runtime => ({
      value: runtime.runtimeKind,
      label: runtime.label,
      description: runtime.description,
      iconKey: runtime.iconKey,
    })),
    [runtimes],
  )
  const profiles = useMemo(
    () => listSelectableComposerProfiles({ profiles: providerOptions, runtimeKind, runtimes }),
    [providerOptions, runtimeKind, runtimes],
  )
  const selectedProviderTarget = useMemo(
    () => profiles.find(profile => profile.id === prefs?.profileId) ?? null,
    [prefs?.profileId, profiles],
  )
  const initialModelProfileIds = useMemo(() => [prefs?.profileId ?? null], [prefs?.profileId])
  const {
    modelsByProviderTargetId: modelsByProfileId,
    loadingProviderTargetIds: loadingProfileIds,
    successfulProviderTargetIds: successfulProfileIds,
    requestProviderTargetModels: requestProfileModels,
  } = useProviderTargetModelMap(
    profiles,
    initialModelProfileIds,
  )
  const selectedModels = selectedProviderTarget ? modelsByProfileId[selectedProviderTarget.id] ?? [] : []
  const selectedModel = selectedModels.find(model => model.id === prefs?.model) ?? null
  const selectedProviderTargetModelsReady = !selectedProviderTarget
    || !selectedProviderTarget.enabled
    || successfulProfileIds.has(selectedProviderTarget.id)
  const settingsJarvisReady = prefsReady && providerTargetsReady && selectedProviderTargetModelsReady
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

      <SettingsRow label={t('jarvis.runtime.label')} description={t('jarvis.runtime.description')}>
        <RuntimeSelector
          value={runtimeKind}
          onChange={(nextRuntimeKind) => {
            const nextProfiles = listSelectableComposerProfiles({ profiles: providerOptions, runtimeKind: nextRuntimeKind, runtimes })
            const currentProfileStillValid = prefs.profileId
              ? nextProfiles.some(profile => profile.id === prefs.profileId)
              : false
            const nextProfile = currentProfileStillValid
              ? nextProfiles.find(profile => profile.id === prefs.profileId) ?? null
              : nextProfiles[0] ?? null
            void save({
              runtimeKind: nextRuntimeKind,
              profileId: nextProfile?.id ?? null,
              model: undefined,
            })
            if (nextProfile) {
              requestProfileModels(nextProfile.id)
            }
          }}
          options={runtimeOptions}
          disabled={saving}
        />
      </SettingsRow>

      <SettingsDivider />

      <SettingsRow label={t('jarvis.model.label')} description={t('jarvis.model.description')}>
        <ProviderModelPicker
          providerTargets={profiles}
          selectedProviderTargetId={prefs.profileId}
          selectedModelId={prefs.model ?? null}
          selectedModel={selectedModel}
          modelsByProviderTargetId={modelsByProfileId}
          loadingProviderTargetIds={loadingProfileIds}
          thinkingValue={prefs.thinkingLevel}
          thinkingOptions={thinkingOptions}
          emptyProviderTargetsLabel={t('jarvis.model.emptyProfiles')}
          emptySelectionLabel={t('jarvis.model.emptySelection')}
          menuSide="bottom"
          menuAlign="end"
          triggerTestId="jarvis-provider-model-selector"
          disabled={saving}
          getThinkingOptionsForModel={model => filterThinkingOptionsForModel(model, thinkingOptions)}
          onRequestProviderTargetModels={requestProfileModels}
          onSelectProviderTarget={(profileId) => {
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
