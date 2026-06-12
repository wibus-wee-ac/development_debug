import { KeyboardIcon } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/ui/select'
import { Switch } from '~/components/ui/switch'
import type { MacInputBareModifier } from '~/lib/electron'
import { isElectron, nativeIpc } from '~/lib/electron'

import { SettingsGroup, SettingsPage } from './settings-container'
import { SettingsRow } from './settings-row'
import type { DesktopPreferences } from './use-desktop-preferences'
import { useDesktopPreferences } from './use-desktop-preferences'

type SettingsKey = keyof typeof import('~/locales/default').default.settings

const APP_SHOT_HOTKEY_TRIGGERS: MacInputBareModifier[] = [
  'DoubleCommand',
  'DoubleOption',
  'DoubleShift'
]

const APP_SHOT_HOTKEY_LABEL_KEYS = {
  DoubleCommand: 'shortcut.appshotHotkey.option.command',
  DoubleOption: 'shortcut.appshotHotkey.option.option',
  DoubleShift: 'shortcut.appshotHotkey.option.shift'
} satisfies Record<MacInputBareModifier, SettingsKey>

function isAppshotHotkeyTrigger(value: string): value is MacInputBareModifier {
  return APP_SHOT_HOTKEY_TRIGGERS.includes(value as MacInputBareModifier)
}

export function ShortcutSettings() {
  const { t } = useTranslation('settings')
  const {
    prefs: desktopPrefs,
    isSaving: isSavingDesktopPrefs,
    savePrefs: saveDesktopPrefs
  } = useDesktopPreferences()

  const savePreference = useCallback(
    (updates: Partial<DesktopPreferences>) => {
      void saveDesktopPrefs(updates).then((updated) => {
        if (updated && isElectron && nativeIpc) {
          void nativeIpc.native.setDesktopPreferences(updated).catch(() => {})
        }
      })
    },
    [saveDesktopPrefs]
  )

  const prefsDisabled = !desktopPrefs || isSavingDesktopPrefs
  const selectedTrigger = desktopPrefs?.appshotHotkeyTrigger ?? 'DoubleCommand'

  return (
    <SettingsPage
      title={t('shortcut.page.title' as SettingsKey)}
      description={t('shortcut.page.description' as SettingsKey)}
      action={
        isElectron ? (
          <Badge variant="outline" className="gap-1.5 font-mono text-[11px]">
            <KeyboardIcon className="size-3" aria-hidden="true" />
            {t('shortcut.badge.desktop' as SettingsKey)}
          </Badge>
        ) : undefined
      }
      data-testid="shortcut-settings"
    >
      <SettingsGroup>
        <SettingsRow
          label={t('shortcut.appshotHotkey.label' as SettingsKey)}
          description={t('shortcut.appshotHotkey.description' as SettingsKey)}
        >
          <div className="flex items-center gap-3">
            <Select
              value={selectedTrigger}
              onValueChange={(value) => {
                if (isAppshotHotkeyTrigger(value)) {
                  savePreference({ appshotHotkeyTrigger: value })
                }
              }}
              disabled={prefsDisabled}
            >
              <SelectTrigger
                size="sm"
                className="w-40"
                aria-label={t('shortcut.appshotHotkey.triggerLabel' as SettingsKey)}
                data-testid="shortcut-appshot-hotkey-trigger"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APP_SHOT_HOTKEY_TRIGGERS.map((trigger) => (
                  <SelectItem key={trigger} value={trigger}>
                    {t(APP_SHOT_HOTKEY_LABEL_KEYS[trigger])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Switch
              checked={desktopPrefs?.appshotHotkeyEnabled ?? true}
              onCheckedChange={(appshotHotkeyEnabled) => savePreference({ appshotHotkeyEnabled })}
              disabled={prefsDisabled}
              aria-label={t('shortcut.appshotHotkey.enabledLabel' as SettingsKey)}
              data-testid="shortcut-appshot-hotkey"
            />
          </div>
        </SettingsRow>
      </SettingsGroup>

      {!isElectron && (
        <p className="text-[12px] text-muted-foreground" data-testid="shortcut-web-notice">
          {t('shortcut.webNotice.description' as SettingsKey)}
        </p>
      )}
    </SettingsPage>
  )
}
