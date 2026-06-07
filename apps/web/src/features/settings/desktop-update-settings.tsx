import { DownloadIcon, PackageCheckIcon, RefreshCwIcon, RotateCwIcon, TerminalIcon, UnlinkIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Progress } from '~/components/ui/progress'
import { Spinner } from '~/components/ui/spinner'
import { Switch } from '~/components/ui/switch'
import type { DesktopCliStatus, DesktopUpdateStatus } from '~/lib/electron'
import { isElectron, nativeIpc, subscribeDesktopUpdateStatus } from '~/lib/electron'
import { formatCompactBytes } from '~/lib/number-format'

import { SettingsDivider, SettingsRow, SettingsSectionHeader } from './settings-row'
import { useDesktopPreferences } from './use-desktop-preferences'

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

function StatusBadge({ status }: { status: DesktopUpdateStatus }) {
  const label = (() => {
    if (status.unsupported) {
      return 'Unavailable'
    }
    if (status.isCheckingForUpdates) {
      return 'Checking'
    }
    if (status.isDownloadingUpdate) {
      return 'Downloading'
    }
    if (status.updateDownloaded) {
      return 'Ready'
    }
    if (status.updateInfo) {
      return 'Available'
    }
    return 'Current'
  })()

  return (
    <Badge variant={status.errorMessage ? 'destructive' : 'outline'} className="font-mono text-[11px]">
      {label}
    </Badge>
  )
}

function CliStatusBadge({ status }: { status: DesktopCliStatus }) {
  const label = (() => {
    if (!status.supported) {
      return 'Unavailable'
    }
    if (status.installed) {
      return 'Installed'
    }
    if (status.requiresRepair) {
      return 'Repair'
    }
    return 'Not installed'
  })()

  return (
    <Badge variant={status.errorMessage ? 'destructive' : 'outline'} className="font-mono text-[11px]">
      {label}
    </Badge>
  )
}

export function DesktopUpdateSettings() {
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

  const refreshStatus = async () => {
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
  }

  const runCliAction = async (
    action: () => Promise<DesktopCliStatus>,
  ) => {
    setLoading(true)
    try {
      setCliStatus(await action())
    }
    finally {
      setLoading(false)
    }
  }

  const runUpdateAction = async (
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
  }

  const handleDoubleCommandQChange = (requireDoubleCommandQToQuit: boolean) => {
    void saveDesktopPrefs({ requireDoubleCommandQToQuit }).then((updated) => {
      if (updated && isElectron && nativeIpc) {
        void nativeIpc.native.setDesktopPreferences(updated).catch(() => {})
      }
    })
  }

  useEffect(() => {
    void refreshStatus()
    return subscribeDesktopUpdateStatus(setStatus)
  }, [refreshStatus])

  return (
    <div
      className="flex flex-col gap-0"
      data-testid="desktop-update-settings"
      data-settings-desktop-ready={statusReady ? 'true' : 'false'}
    >
      <SettingsSectionHeader
        title="Desktop"
        description="Manage packaged Desktop app behavior, updates, and CLI integration."
        action={<StatusBadge status={status} />}
      />
      <SettingsDivider />

      <SettingsRow
        label="Double Command+Q to quit"
        description="Require pressing Command+Q twice within a short window before Cradle quits."
      >
        <Switch
          checked={desktopPrefs?.requireDoubleCommandQToQuit ?? true}
          onCheckedChange={handleDoubleCommandQChange}
          disabled={!desktopPrefs || isSavingDesktopPrefs}
          aria-label="Double Command+Q to quit"
          data-testid="desktop-double-command-q"
        />
      </SettingsRow>
      <SettingsDivider />

      <SettingsSectionHeader
        title="Desktop Updates"
        description="Manage updates for the packaged Desktop app."
        className="pt-6"
      />
      <SettingsDivider />

      <SettingsRow label="Installed version" description="The currently running Desktop build.">
        <span className="font-mono text-[12px] tabular-nums text-foreground">{status.currentVersion}</span>
      </SettingsRow>
      <SettingsDivider />

      <SettingsRow
        label="Available update"
        description={targetVersion ? `Version ${targetVersion} is available.` : 'No downloaded update metadata is currently available.'}
      >
        <div className="flex min-w-44 flex-col items-end gap-1">
          <span className="font-mono text-[12px] tabular-nums text-foreground">
            {targetVersion ?? 'None'}
          </span>
          {targetSize > 0 && (
            <span className="text-[11px] text-muted-foreground">{formatCompactBytes(targetSize)}</span>
          )}
        </div>
      </SettingsRow>
      <SettingsDivider />

      <SettingsRow
        label="Download progress"
        description="Progress is reported while the selected update is being downloaded."
        vertical
      >
        <div className="flex w-full items-center gap-3">
          <Progress value={status.downloadingProgress} className="h-1.5 flex-1" />
          <span className="w-12 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
            {Math.round(status.downloadingProgress)}
            %
          </span>
        </div>
      </SettingsRow>
      <SettingsDivider />

      <SettingsRow
        label="Actions"
        description={status.errorMessage ?? 'Check for updates, download the available package, then apply it when ready.'}
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refreshStatus()}
            disabled={!isElectron || !nativeIpc || busy}
          >
            {loading ? <Spinner className="size-3.5" /> : <RefreshCwIcon className="size-3.5" aria-hidden="true" />}
            Refresh
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
            Check
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void runUpdateAction(() => nativeIpc!.desktopUpdate.downloadUpdate())}
            disabled={!canDownload}
          >
            <DownloadIcon className="size-3.5" aria-hidden="true" />
            Download
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => void runUpdateAction(() => nativeIpc!.desktopUpdate.applyUpdate())}
            disabled={!canApply}
          >
            <RotateCwIcon className="size-3.5" aria-hidden="true" />
            Restart
          </Button>
        </div>
      </SettingsRow>
      <SettingsDivider />

      <SettingsSectionHeader
        title="CLI Command"
        description="Install the cradle command so terminal workflows can reach the running Desktop server."
        action={<CliStatusBadge status={cliStatus} />}
        className="pt-6"
      />
      <SettingsDivider />

      <SettingsRow
        label="Command path"
        description={cliStatus.errorMessage ?? 'The command is installed as a symlink to the packaged Desktop launcher.'}
      >
        <div className="flex min-w-44 flex-col items-end gap-1">
          <span className="font-mono text-[12px] tabular-nums text-foreground">{cliStatus.commandPath}</span>
          {cliStatus.sourcePath && (
            <span className="max-w-96 truncate text-right font-mono text-[11px] text-muted-foreground">
              {cliStatus.sourcePath}
            </span>
          )}
        </div>
      </SettingsRow>
      <SettingsDivider />

      <SettingsRow
        label="CLI actions"
        description="Install, repair, or remove the PATH command for this Desktop build."
      >
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refreshStatus()}
            disabled={!isElectron || !nativeIpc || loading}
          >
            {loading ? <Spinner className="size-3.5" /> : <RefreshCwIcon className="size-3.5" aria-hidden="true" />}
            Refresh
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void runCliAction(() => nativeIpc!.native.removeDesktopCliCommand())}
            disabled={!isElectron || !nativeIpc || loading || !cliStatus.supported || !cliStatus.installed}
          >
            <UnlinkIcon className="size-3.5" aria-hidden="true" />
            Remove
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => void runCliAction(() => nativeIpc!.native.installDesktopCliCommand())}
            disabled={!isElectron || !nativeIpc || loading || !cliStatus.supported}
          >
            <TerminalIcon className="size-3.5" aria-hidden="true" />
            {cliStatus.installed ? 'Repair' : 'Install'}
          </Button>
        </div>
      </SettingsRow>
    </div>
  )
}
