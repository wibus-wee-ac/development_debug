import {
  AnticlockwiseLine as RotateCcwIcon,
  SaveLine as SaveIcon,
  ServerLine as ServerIcon,
  WifiLine as WifiIcon
} from '@mingcute/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import {
  clearCustomServerUrl,
  getDefaultServerUrl,
  normalizeServerEndpointUrl,
  readCustomServerUrl,
  writeCustomServerUrl,
} from '~/lib/server-endpoint-preferences'

import { SettingsGroup, SettingsPage } from './settings-container'
import { SettingsRow } from './settings-row'

type TestStatus = { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'success', message: string }
  | { kind: 'error', message: string }

export function ServerEndpointSettings() {
  const { t } = useTranslation('settings')
  const defaultUrl = useMemo(() => getDefaultServerUrl(), [])
  const customUrl = useMemo(() => readCustomServerUrl(), [])
  const [draftUrl, setDraftUrl] = useState(customUrl ?? defaultUrl)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [testStatus, setTestStatus] = useState<TestStatus>({ kind: 'idle' })

  const normalizedDraft = useMemo(() => {
    try {
      return normalizeServerEndpointUrl(draftUrl)
    }
    catch {
      return null
    }
  }, [draftUrl])
  const savedUrl = customUrl ?? defaultUrl
  const canSave = draftUrl.trim().length > 0 && (normalizedDraft === null || normalizedDraft !== savedUrl)

  function validateDraft(): string | null {
    try {
      normalizeServerEndpointUrl(draftUrl)
      setValidationError(null)
      return null
    }
    catch {
      const message = t('serverEndpoint.error.invalidUrl')
      setValidationError(message)
      return message
    }
  }

  function save(): void {
    if (validateDraft()) {
      return
    }
    writeCustomServerUrl(draftUrl)
    window.location.reload()
  }

  function reset(): void {
    clearCustomServerUrl()
    window.location.reload()
  }

  async function testConnection(): Promise<void> {
    if (validateDraft()) {
      return
    }

    const url = normalizeServerEndpointUrl(draftUrl)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 4_000)
    setTestStatus({ kind: 'checking' })

    try {
      const response = await fetch(new URL('/health', url), {
        cache: 'no-store',
        signal: controller.signal,
      })

      if (!response.ok) {
        setTestStatus({ kind: 'error', message: t('serverEndpoint.test.httpError', { status: response.status }) })
        return
      }

      setTestStatus({ kind: 'success', message: t('serverEndpoint.test.success') })
    }
    catch {
      setTestStatus({ kind: 'error', message: t('serverEndpoint.test.unreachable') })
    }
    finally {
      window.clearTimeout(timeout)
    }
  }

  return (
    <SettingsPage
      title={t('serverEndpoint.page.title')}
      description={t('serverEndpoint.page.description')}
      action={(
        <Badge variant={customUrl ? 'default' : 'secondary'}>
          {customUrl ? t('serverEndpoint.badge.custom') : t('serverEndpoint.badge.default')}
        </Badge>
      )}
      data-testid="server-endpoint-settings"
    >
      <SettingsGroup>
        <SettingsRow
          label={t('serverEndpoint.current.label')}
          description={t('serverEndpoint.current.description')}
        >
          <div className="flex max-w-[360px] items-center justify-end gap-2 text-right">
            <ServerIcon className="size-3.5 shrink-0 !text-muted-foreground" aria-hidden="true" />
            <span className="truncate text-[12px] font-medium text-foreground">{savedUrl}</span>
          </div>
        </SettingsRow>

        <SettingsRow
          label={t('serverEndpoint.url.label')}
          description={validationError ?? t('serverEndpoint.url.description')}
          vertical
        >
          <div className="flex flex-col gap-2">
            <Input
              value={draftUrl}
              onChange={(event) => {
                setDraftUrl(event.target.value)
                setValidationError(null)
                setTestStatus({ kind: 'idle' })
              }}
              placeholder={defaultUrl}
              aria-invalid={validationError ? 'true' : undefined}
              data-testid="server-endpoint-url-input"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" onClick={save} disabled={!canSave}>
                <SaveIcon data-icon="inline-start" aria-hidden="true" />
                {t('serverEndpoint.action.save')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void testConnection()}
                disabled={testStatus.kind === 'checking'}
              >
                <WifiIcon data-icon="inline-start" aria-hidden="true" />
                {testStatus.kind === 'checking'
                  ? t('serverEndpoint.action.testing')
                  : t('serverEndpoint.action.test')}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={reset} disabled={!customUrl}>
                <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
                {t('serverEndpoint.action.reset')}
              </Button>
            </div>
            {testStatus.kind !== 'idle' && testStatus.kind !== 'checking' && (
              <p
                className={testStatus.kind === 'success'
                  ? 'text-[12px] text-emerald-600 dark:text-emerald-400'
                  : 'text-[12px] text-destructive'}
              >
                {testStatus.message}
              </p>
            )}
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label={t('serverEndpoint.fallback.label')} description={t('serverEndpoint.fallback.description')}>
        <SettingsRow label={t('serverEndpoint.default.label')} description={t('serverEndpoint.default.description')}>
          <span className="block max-w-[360px] truncate text-right text-[12px] font-medium text-muted-foreground">
            {defaultUrl}
          </span>
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  )
}
