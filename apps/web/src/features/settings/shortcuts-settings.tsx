import { KeyboardIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { Switch } from '~/components/ui/switch'
import { isElectron, nativeIpc } from '~/lib/electron'

import { SettingsDivider, SettingsRow, SettingsSectionHeader } from './settings-row'
import { useDesktopPreferences } from './use-desktop-preferences'

export function ShortcutsSettings() {
  const { t } = useTranslation('settings')
  const {
    prefs: desktopPrefs,
    isSaving: isSavingDesktopPrefs,
    savePrefs: saveDesktopPrefs,
  } = useDesktopPreferences()

  const handleAppshotHotkeyChange = (appshotHotkeyEnabled: boolean) => {
    void saveDesktopPrefs({ appshotHotkeyEnabled }).then((updated) => {
      if (updated && isElectron && nativeIpc) {
        void nativeIpc.native.setDesktopPreferences(updated).catch(() => {})
      }
    })
  }

  return (
    <div
      className="flex flex-col gap-0"
      data-testid="shortcuts-settings"
      data-settings-shortcuts-ready={desktopPrefs ? 'true' : 'false'}
    >
      <SettingsSectionHeader
        title={t('shortcuts.page.title')}
        description={t('shortcuts.page.description')}
        action={(
          <Badge variant="outline" className="gap-1.5 font-mono text-[11px]">
            <KeyboardIcon className="size-3" aria-hidden="true" />
            {t('shortcuts.badge.desktop')}
          </Badge>
        )}
      />
      <SettingsDivider />

      <SettingsRow
        label={t('shortcuts.appshotHotkey.label')}
        description={t('shortcuts.appshotHotkey.description')}
      >
        <div className="flex items-center gap-3">
          <kbd className="rounded-md border border-border bg-muted px-2 py-1 font-mono text-[11px] text-foreground">
            {t('shortcuts.appshotHotkey.key')}
          </kbd>
          <Switch
            checked={desktopPrefs?.appshotHotkeyEnabled ?? true}
            onCheckedChange={handleAppshotHotkeyChange}
            disabled={!desktopPrefs || isSavingDesktopPrefs}
            aria-label={t('shortcuts.appshotHotkey.label')}
            data-testid="shortcuts-appshot-hotkey"
          />
        </div>
      </SettingsRow>
    </div>
  )
}
