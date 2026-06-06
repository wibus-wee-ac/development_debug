import { FolderIcon, HardDriveIcon, ShieldAlertIcon, TerminalIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { isElectron, nativeIpc } from '~/lib/electron'

import { SettingsDivider, SettingsRow, SettingsSectionHeader } from './settings-row'

type SettingsKey = keyof typeof import('~/locales/default').default.settings

interface CradleDataPaths {
  userDataPath: string
  serverDataPath: string
  databasePath: string
  serverLogPath: string
}

const EXTERNAL_WRITE_ROWS: Array<{
  icon: typeof FolderIcon
  labelKey: SettingsKey
  descriptionKey: SettingsKey
  pathKey: SettingsKey
}> = [
  {
    icon: FolderIcon,
    labelKey: 'about.external.workspace.label',
    descriptionKey: 'about.external.workspace.description',
    pathKey: 'about.external.workspace.path',
  },
  {
    icon: HardDriveIcon,
    labelKey: 'about.external.skills.label',
    descriptionKey: 'about.external.skills.description',
    pathKey: 'about.external.skills.path',
  },
  {
    icon: TerminalIcon,
    labelKey: 'about.external.cli.label',
    descriptionKey: 'about.external.cli.description',
    pathKey: 'about.external.cli.path',
  },
]

export function AboutSettings() {
  const { t } = useTranslation('settings')
  const [paths, setPaths] = useState<CradleDataPaths | null>(null)

  useEffect(() => {
    if (!isElectron || !nativeIpc) {
      return
    }

    let cancelled = false
    void nativeIpc.native.getCradleDataPaths().then((nextPaths) => {
      if (!cancelled) {
        setPaths(nextPaths)
      }
    }).catch(() => {
      if (!cancelled) {
        setPaths(null)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div
      className="flex flex-col gap-0"
      data-testid="about-settings"
      data-settings-about-ready="true"
    >
      <SettingsSectionHeader
        title={t('about.page.title')}
        description={t('about.page.description')}
        action={<Badge variant="outline" className="font-mono text-[11px]">{t('about.badge.local')}</Badge>}
      />
      <SettingsDivider />

      <div className="flex items-start gap-3 py-4">
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300">
          <ShieldAlertIcon className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h4 className="text-[13px] font-medium text-foreground">{t('about.notice.title')}</h4>
          <p className="mt-1 max-w-2xl text-[12px] leading-5 text-muted-foreground text-pretty">
            {t('about.notice.description')}
          </p>
        </div>
      </div>
      <SettingsDivider />

      <SettingsRow
        label={t('about.storage.applicationSupport.label')}
        description={t('about.storage.applicationSupport.description')}
      >
        <PathValue value={paths?.serverDataPath ?? t('about.storage.applicationSupport.fallback')} />
      </SettingsRow>
      <SettingsDivider />

      <SettingsRow
        label={t('about.storage.database.label')}
        description={t('about.storage.database.description')}
      >
        <PathValue value={paths?.databasePath ?? t('about.storage.database.fallback')} />
      </SettingsRow>
      <SettingsDivider />

      <div className="py-4">
        <h4 className="text-[13px] font-medium text-foreground">{t('about.external.title')}</h4>
        <p className="mt-1 text-[12px] leading-5 text-muted-foreground text-pretty">
          {t('about.external.description')}
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {EXTERNAL_WRITE_ROWS.map(({ icon: Icon, labelKey, descriptionKey, pathKey }) => (
            <div key={labelKey} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3 gap-y-1 py-1">
              <Icon className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-foreground">{t(labelKey)}</div>
                <div className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{t(descriptionKey)}</div>
                <div className="mt-1 font-mono text-[11px] leading-4 text-muted-foreground/80 break-all">{t(pathKey)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <SettingsDivider />

      <SettingsRow
        label={t('about.readOnly.label')}
        description={t('about.readOnly.description')}
      >
        <span className="text-[12px] text-muted-foreground">{t('about.readOnly.value')}</span>
      </SettingsRow>
    </div>
  )
}

function PathValue({ value }: { value: string }) {
  return (
    <span className="block max-w-80 break-all text-right font-mono text-[11px] leading-4 text-muted-foreground">
      {value}
    </span>
  )
}
