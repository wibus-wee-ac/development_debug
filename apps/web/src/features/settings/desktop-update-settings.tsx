import { DownloadIcon, PackageCheckIcon, RefreshCwIcon, RotateCwIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Progress } from '~/components/ui/progress'
import { Spinner } from '~/components/ui/spinner'
import { type DesktopUpdateStatus, isElectron, nativeIpc, subscribeDesktopUpdateStatus } from '~/lib/electron'

import { SettingsDivider, SettingsRow, SettingsSectionHeader } from './settings-row'

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

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB'] as const
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const amount = value / 1024 ** exponent
  return `${amount.toFixed(amount >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

function readTargetVersion(status: DesktopUpdateStatus): string | null {
  return status.updateInfo?.TargetFullRelease.Version ?? null
}

function readTargetSize(status: DesktopUpdateStatus): number {
  const fullSize = status.updateInfo?.TargetFullRelease.Size ?? 0
  const deltaSize = status.updateInfo?.DeltasToTarget.reduce((sum, asset) => sum + asset.Size, 0) ?? 0
  return deltaSize > 0 ? deltaSize : fullSize
}

function StatusBadge({ status }: { status: DesktopUpdateStatus }) {
  const label = useMemo(() => {
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
  }, [status])

  return (
    <Badge variant={status.errorMessage ? 'destructive' : 'outline'} className="font-mono text-[11px]">
      {label}
    </Badge>
  )
}

export function DesktopUpdateSettings() {
  const [status, setStatus] = useState<DesktopUpdateStatus>(EMPTY_UPDATE_STATUS)
  const [loading, setLoading] = useState(false)

  const targetVersion = readTargetVersion(status)
  const targetSize = readTargetSize(status)
  const busy = loading || status.isCheckingForUpdates || status.isDownloadingUpdate
  const canCheck = isElectron && !!nativeIpc && !status.unsupported && !busy
  const canDownload = canCheck && !!status.updateInfo && !status.updateDownloaded
  const canApply = isElectron && !!nativeIpc && !status.unsupported && status.updateDownloaded && !busy

  const refreshStatus = useCallback(async () => {
    if (!isElectron || !nativeIpc) {
      setStatus(EMPTY_UPDATE_STATUS)
      return
    }

    setLoading(true)
    try {
      setStatus(await nativeIpc.desktopUpdate.getStatus())
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

  useEffect(() => {
    void refreshStatus()
    return subscribeDesktopUpdateStatus(setStatus)
  }, [refreshStatus])

  return (
    <div className="flex flex-col gap-0">
      <SettingsSectionHeader
        title="Desktop Updates"
        description="Manage Velopack updates for the packaged Desktop app."
        action={<StatusBadge status={status} />}
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
            <span className="text-[11px] text-muted-foreground">{formatBytes(targetSize)}</span>
          )}
        </div>
      </SettingsRow>
      <SettingsDivider />

      <SettingsRow
        label="Download progress"
        description="Progress is reported by Velopack while the selected update is being downloaded."
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
    </div>
  )
}
