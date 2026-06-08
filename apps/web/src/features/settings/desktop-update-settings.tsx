import { DownloadIcon, MonitorIcon, PackageCheckIcon, RefreshCwIcon, RotateCwIcon, TerminalIcon, UnlinkIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Progress } from '~/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import type { DesktopCliStatus, DesktopUpdateStatus, MacInputBareModifier } from '~/lib/electron'
import { isElectron, nativeIpc, subscribeDesktopUpdateStatus } from '~/lib/electron'
import { formatCompactBytes } from '~/lib/number-format'

import { SettingsGroup, SettingsPage } from './settings-container'
import { SettingsDivider, SettingsRow } from './settings-row'
import type { DesktopPreferences } from './use-desktop-preferences'
import { useDesktopPreferences } from './use-desktop-preferences'

type SettingsKey = keyof typeof import('~/locales/default').default.settings

const APP_SHOT_HOTKEY_TRIGGERS: MacInputBareModifier[] = [
  'DoubleCommand',
  'DoubleOption',
  'DoubleShift',
]

const APP_SHOT_HOTKEY_LABEL_KEYS = {
  DoubleCommand: 'desktop.appshotHotkey.option.command',
  DoubleOption: 'desktop.appshotHotkey.option.option',
  DoubleShift: 'desktop.appshotHotkey.option.shift',
} satisfies Record<MacInputBareModifier, SettingsKey>

function isAppshotHotkeyTrigger(value: string): value is MacInputBareModifier {
  return APP_SHOT_HOTKEY_TRIGGERS.includes(value as MacInputBareModifier)
}

const EMPTY_UPDATE_STATUS: DesktopUpdateStatus = {
  unsupported: true,
  currentVersion: '0.0.0',
  isCheckingForUpdates: false,
  isDownloadingUpdate: false,
  downloadingProgress: 0,
  updateDownloaded: false,
  updateInfo: null,
  errorMessage: 'Desktop updates are only available in the Electron app',
}

const EMPTY_CLI_STATUS: DesktopCliStatus = {
  supported: false,
  installed: false,
  linked: false,
  requiresRepair: false,
  commandPath: '/usr/local/bin/cradle',
  sourcePath: null,
  errorMessage: 'CLI installation is only available in the Electron app',
}

function readTargetVersion(status: DesktopUpdateStatus): string | null {
  return status.updateInfo?.version ?? null
}

function readTargetSize(status: DesktopUpdateStatus): number {
  return status.updateInfo?.files.reduce((sum, file) => sum + (file.size ?? 0), 0) ?? 0
}

/** A compact bordered card that frames an operational section below the preferences. */
function OperationsCard({
  title,
  badge,
  children,
  testId,
}: {
  title: string
  badge: React.ReactNode
  children: React.ReactNode
  testId?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-card/40" data-testid={testId}>
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <span className="text-[12px] font-medium text-foreground">{title}</span>
        {badge}
      </div>
      <SettingsDivider />
      <div className="flex flex-col gap-3 px-4 py-3">
        {children}
      </div>
    </div>
  )
}

export function DesktopUpdateSettings() {
  const { t } = useTranslation('settings')
  const [status, setStatus] = useState<DesktopUpdateStatus>(EMPTY_UPDATE_STATUS)
  const [cliStatus, setCliStatus] = useState<DesktopCliStatus>(EMPTY_CLI_STATUS)
  const [statusReady, setStatusReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const {
    prefs: desktopPrefs,
    isSaving: isSavingDesktopPrefs,
    savePrefs: saveDesktopPrefs,
  } = useDesktopPreferences()

  const targetVersion = readTargetVersion(status)
  const targetSize = readTargetSize(status)
  const busy = loading || status.isCheckingForUpdates || status.isDownloadingUpdate
  const canCheck = isElectron && !!nativeIpc && !status.unsupported && !busy
  const canDownload = canCheck && !!status.updateInfo && !status.updateDownloaded
  const canApply = isElectron && !!nativeIpc && !status.unsupported && status.updateDownloaded && !busy

  const updateStatusLabel = useMemo(() => {
    if (status.unsupported) {
      return t('desktop.updates.status.unavailable' as SettingsKey)
    }
    if (status.isCheckingForUpdates) {
      return t('desktop.updates.status.checking' as SettingsKey)
    }
    if (status.isDownloadingUpdate) {
      return t('desktop.updates.status.downloading' as SettingsKey)
    }
    if (status.updateDownloaded) {
      return t('desktop.updates.status.ready' as SettingsKey)
    }
    if (status.updateInfo) {
      return t('desktop.updates.status.available' as SettingsKey)
    }
    return t('desktop.updates.status.current' as SettingsKey)
  }, [status, t])

  const cliStatusLabel = useMemo(() => {
    if (!cliStatus.supported) {
      return t('desktop.cli.status.unavailable' as SettingsKey)
    }
    if (cliStatus.installed) {
      return t('desktop.cli.status.installed' as SettingsKey)
    }
    if (cliStatus.requiresRepair) {
      return t('desktop.cli.status.repair' as SettingsKey)
    }
    return t('desktop.cli.status.notInstalled' as SettingsKey)
  }, [cliStatus, t])

  const refreshStatus = useCallback(async () => {
    if (!isElectron || !nativeIpc) {
      setStatus(EMPTY_UPDATE_STATUS)
      setCliStatus(EMPTY_CLI_STATUS)
      setStatusReady(true)
      return
    }

    setLoading(true)
    try {
      const [nextStatus, nextCliStatus] = await Promise.all([
        nativeIpc.desktopUpdate.getStatus(),
        nativeIpc.native.getDesktopCliStatus(),
      ])
      setStatus(nextStatus)
      setCliStatus(nextCliStatus)
      setStatusReady(true)
    }
    finally {
      setLoading(false)
    }
  }, [])

  const runCliAction = useCallback(async (
    action: () => Promise<DesktopCliStatus>,
  ) => {
    setLoading(true)
    try {
      setCliStatus(await action())
    }
    finally {
      setLoading(false)
    }
  }, [])

  const runUpdateAction = useCallback(async (
    action: () => Promise<DesktopUpdateStatus | void>,
  ) => {
    setLoading(true)
    try {
      const nextStatus = await action()
      if (nextStatus) {
        setStatus(nextStatus)
      }
    }
    finally {
      setLoading(false)
    }
  }, [])

  const savePreference = useCallback((updates: Partial<DesktopPreferences>) => {
    void saveDesktopPrefs(updates).then((updated) => {
      if (updated && isElectron && nativeIpc) {
        void nativeIpc.native.setDesktopPreferences(updated).catch(() => {})
      }
    })
  }, [saveDesktopPrefs])

  useEffect(() => {
    void refreshStatus()
    return subscribeDesktopUpdateStatus(setStatus)
  }, [refreshStatus])

  const prefsDisabled = !desktopPrefs || isSavingDesktopPrefs

  return (
    <SettingsPage
      title={t('desktop.page.title' as SettingsKey)}
      description={t('desktop.page.description' as SettingsKey)}
      action={isElectron
        ? (
          <Badge variant="outline" className="gap-1.5 font-mono text-[11px]">
            <MonitorIcon className="size-3" aria-hidden="true" />
            {t('desktop.badge.desktop' as SettingsKey)}
          </Badge>
        )
        : undefined}
      data-testid="desktop-update-settings"
      data-settings-desktop-ready={statusReady ? 'true' : 'false'}
    >
      <SettingsGroup>
        <SettingsRow
          label={t('desktop.doubleCommandQ.label' as SettingsKey)}
          description={t('desktop.doubleCommandQ.description' as SettingsKey)}
        >
          <Switch
            checked={desktopPrefs?.requireDoubleCommandQToQuit ?? true}
            onCheckedChange={requireDoubleCommandQToQuit => savePreference({ requireDoubleCommandQToQuit })}
            disabled={prefsDisabled}
            aria-label={t('desktop.doubleCommandQ.label' as SettingsKey)}
            data-testid="desktop-double-command-q"
          />
        </SettingsRow>

        <SettingsRow
          label={t('desktop.appshotHotkey.label' as SettingsKey)}
          description={t('desktop.appshotHotkey.description' as SettingsKey)}
        >
          <div className="flex items-center gap-3">
            <Select
              value={desktopPrefs?.appshotHotkeyTrigger ?? 'DoubleCommand'}
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
                aria-label={t('desktop.appshotHotkey.triggerLabel' as SettingsKey)}
                data-testid="desktop-appshot-hotkey-trigger"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APP_SHOT_HOTKEY_TRIGGERS.map(trigger => (
                  <SelectItem key={trigger} value={trigger}>
                    {t(APP_SHOT_HOTKEY_LABEL_KEYS[trigger])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Switch
              checked={desktopPrefs?.appshotHotkeyEnabled ?? true}
              onCheckedChange={appshotHotkeyEnabled => savePreference({ appshotHotkeyEnabled })}
              disabled={prefsDisabled}
              aria-label={t('desktop.appshotHotkey.label' as SettingsKey)}
              data-testid="desktop-appshot-hotkey"
            />
          </div>
        </SettingsRow>

        <SettingsRow
          label={t('desktop.autoCheckForUpdates.label' as SettingsKey)}
          description={t('desktop.autoCheckForUpdates.description' as SettingsKey)}
        >
          <Switch
            checked={desktopPrefs?.autoCheckForUpdates ?? true}
            onCheckedChange={autoCheckForUpdates => savePreference({ autoCheckForUpdates })}
            disabled={prefsDisabled}
            aria-label={t('desktop.autoCheckForUpdates.label' as SettingsKey)}
            data-testid="desktop-auto-check"
          />
        </SettingsRow>

        <SettingsRow
          label={t('desktop.autoDownloadUpdates.label' as SettingsKey)}
          description={t('desktop.autoDownloadUpdates.description' as SettingsKey)}
        >
          <Switch
            checked={desktopPrefs?.autoDownloadUpdates ?? false}
            onCheckedChange={autoDownloadUpdates => savePreference({ autoDownloadUpdates })}
            disabled={prefsDisabled || !(desktopPrefs?.autoCheckForUpdates ?? true)}
            aria-label={t('desktop.autoDownloadUpdates.label' as SettingsKey)}
            data-testid="desktop-auto-download"
          />
        </SettingsRow>
      </SettingsGroup>

      {isElectron
        ? (
          <div className="flex flex-col gap-3">
            <OperationsCard
              title={t('desktop.updates.title' as SettingsKey)}
              testId="desktop-updates-card"
              badge={(
                <Badge variant="outline" className="font-mono text-[11px]">
                  {updateStatusLabel}
                </Badge>
              )}
            >
              <div className="flex items-center justify-between gap-3 text-[12px]">
                <span className="text-muted-foreground">{t('desktop.updates.currentVersion' as SettingsKey)}</span>
                <span className="font-mono tabular-nums text-foreground">{status.currentVersion}</span>
              </div>
              <div className="flex items-center justify-between gap-3 text-[12px]">
                <span className="text-muted-foreground">{t('desktop.updates.availableVersion' as SettingsKey)}</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono tabular-nums text-foreground">
                    {targetVersion ?? t('desktop.updates.none' as SettingsKey)}
                  </span>
                  {targetSize > 0 && (
                    <span className="text-[11px] text-muted-foreground">{formatCompactBytes(targetSize)}</span>
                  )}
                </div>
              </div>

              {status.isDownloadingUpdate && (
                <div className="flex items-center gap-3">
                  <Progress value={status.downloadingProgress} className="h-1.5 flex-1" />
                  <span className="w-10 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                    {Math.round(status.downloadingProgress)}
                    %
                  </span>
                </div>
              )}

              {status.errorMessage && (
                <p className="text-[11px] text-muted-foreground">{status.errorMessage}</p>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void refreshStatus()}
                  disabled={!isElectron || !nativeIpc || busy}
                  aria-label={t('desktop.updates.actions.refresh' as SettingsKey)}
                >
                  {loading ? <Spinner className="size-3.5" /> : <RefreshCwIcon className="size-3.5" aria-hidden="true" />}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void runUpdateAction(() => nativeIpc!.desktopUpdate.checkForUpdates())}
                  disabled={!canCheck}
                >
                  {status.isCheckingForUpdates
                    ? <Spinner className="size-3.5" />
                    : <PackageCheckIcon className="size-3.5" aria-hidden="true" />}
                  {t('desktop.updates.actions.check' as SettingsKey)}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void runUpdateAction(() => nativeIpc!.desktopUpdate.downloadUpdate())}
                  disabled={!canDownload}
                >
                  <DownloadIcon className="size-3.5" aria-hidden="true" />
                  {t('desktop.updates.actions.download' as SettingsKey)}
                </Button>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => void runUpdateAction(() => nativeIpc!.desktopUpdate.applyUpdate())}
                  disabled={!canApply}
                >
                  <RotateCwIcon className="size-3.5" aria-hidden="true" />
                  {t('desktop.updates.actions.restart' as SettingsKey)}
                </Button>
              </div>
            </OperationsCard>

            <OperationsCard
              title={t('desktop.cli.title' as SettingsKey)}
              testId="desktop-cli-card"
              badge={(
                <Badge variant="outline" className="font-mono text-[11px]">
                  {cliStatusLabel}
                </Badge>
              )}
            >
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[12px] tabular-nums text-foreground break-all">{cliStatus.commandPath}</span>
                {cliStatus.sourcePath && (
                  <span className="font-mono text-[11px] text-muted-foreground break-all">{cliStatus.sourcePath}</span>
                )}
                {cliStatus.errorMessage && (
                  <p className="text-[11px] text-muted-foreground">{cliStatus.errorMessage}</p>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void refreshStatus()}
                  disabled={!isElectron || !nativeIpc || loading}
                  aria-label={t('desktop.cli.actions.refresh' as SettingsKey)}
                >
                  {loading ? <Spinner className="size-3.5" /> : <RefreshCwIcon className="size-3.5" aria-hidden="true" />}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void runCliAction(() => nativeIpc!.native.removeDesktopCliCommand())}
                  disabled={!isElectron || !nativeIpc || loading || !cliStatus.supported || !cliStatus.installed}
                >
                  <UnlinkIcon className="size-3.5" aria-hidden="true" />
                  {t('desktop.cli.actions.remove' as SettingsKey)}
                </Button>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => void runCliAction(() => nativeIpc!.native.installDesktopCliCommand())}
                  disabled={!isElectron || !nativeIpc || loading || !cliStatus.supported}
                >
                  <TerminalIcon className="size-3.5" aria-hidden="true" />
                  {cliStatus.installed
                    ? t('desktop.cli.actions.repair' as SettingsKey)
                    : t('desktop.cli.actions.install' as SettingsKey)}
                </Button>
              </div>
            </OperationsCard>
          </div>
        )
        : (
          <p className="text-[12px] text-muted-foreground" data-testid="desktop-web-notice">
            {t('desktop.webNotice.description' as SettingsKey)}
          </p>
        )}
    </SettingsPage>
  )
}
