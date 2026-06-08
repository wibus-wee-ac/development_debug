import { useTranslation } from 'react-i18next'

import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'

import { SettingsGroup, SettingsPage } from './settings-container'
import { SettingsRow } from './settings-row'
import type { AppPreferences } from './use-app-preferences'
import { useAppPreferences } from './use-app-preferences'

type SettingsKey = keyof typeof import('~/locales/default').default.settings

export function FeatureSettings() {
  const { t } = useTranslation('settings')
  const { prefs, isLoading, savePrefs, isSaving } = useAppPreferences()

  const saveFeatureFlags = (featureFlags: Partial<AppPreferences['featureFlags']>) => {
    if (!prefs) {
      return
    }

    void savePrefs({
      featureFlags: {
        ...prefs.featureFlags,
        ...featureFlags,
      },
    })
  }

  return (
    <SettingsPage
      title={t('features.page.title' as SettingsKey)}
      description={t('features.page.description' as SettingsKey)}
    >
      {isLoading || !prefs
        ? (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-6 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            {t('features.loading' as SettingsKey)}
          </div>
        )
        : (
          <SettingsGroup>
            <SettingsRow
              label={t('features.multiWorkspace.label' as SettingsKey)}
              description={t('features.multiWorkspace.description' as SettingsKey)}
            >
              <Switch
                size="sm"
                checked={prefs.featureFlags.multiWorkspacePoc}
                disabled={isSaving}
                onCheckedChange={checked => saveFeatureFlags({ multiWorkspacePoc: checked })}
                aria-label={t('features.multiWorkspace.label' as SettingsKey)}
              />
            </SettingsRow>
          </SettingsGroup>
        )}
    </SettingsPage>
  )
}
