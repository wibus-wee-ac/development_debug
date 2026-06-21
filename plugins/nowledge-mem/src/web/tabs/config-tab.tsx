/* Settings panel for Nowledge Mem connection and runtime toggles. */

import type { WebPluginContext } from '@cradle/plugin-sdk/web'
import {
  AlertLine as AlertCircleIcon,
  Building2Line,
  CheckCircleLine as CheckCircleIcon,
  LockLine as LockIcon,
} from '@mingcute/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Skeleton } from '~/components/ui/skeleton'
import { Switch } from '~/components/ui/switch'
import { TooltipProvider } from '~/components/ui/tooltip'
import { SettingsDivider, SettingsRow, SettingsSectionHeader } from '~/features/settings/settings-row'
import { cn } from '~/lib/cn'

import { deriveMcpUrl } from '../format'
import type { SaveState } from '../hooks'
import { useNowledgeConfig } from '../hooks'
import type { ConfigFormState } from '../types'

interface ConfigTabProps {
  ctx: WebPluginContext
}

const EMPTY_FORM: ConfigFormState = {
  apiUrl: '',
  mcpUrl: '',
  spaceId: '',
  enabled: true,
}

export function ConfigTab({ ctx }: ConfigTabProps) {
  const { config, loading, error, refresh, save } = useNowledgeConfig(ctx.routes, true)
  const [form, setForm] = useState<ConfigFormState>(EMPTY_FORM)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveRequestRef = useRef(0)
  const savedSignatureRef = useRef<string>('')

  // Sync local form when config first loads or changes externally
  useEffect(() => {
    if (config) {
      setForm({
        apiUrl: config.apiUrl,
        mcpUrl: config.mcpUrl ?? deriveMcpUrl(config.apiUrl),
        spaceId: config.spaceId ?? '',
        enabled: config.enabled,
      })
      savedSignatureRef.current = signatureOf({
        apiUrl: config.apiUrl,
        spaceId: config.spaceId ?? '',
        enabled: config.enabled,
      })
      setSaveState('idle')
    }
  }, [config])

  const signature = useMemo(
    () => signatureOf({ apiUrl: form.apiUrl, spaceId: form.spaceId, enabled: form.enabled }),
    [form.apiUrl, form.spaceId, form.enabled],
  )

  const dirty = signature !== savedSignatureRef.current

  const performSave = useCallback(async (formToSave: ConfigFormState) => {
    const requestId = ++saveRequestRef.current
    setSaveState('saving')
    try {
      await save(formToSave)
      if (saveRequestRef.current !== requestId) { return }
      setSaveState('saved')
      ctx.notifications.show({ title: 'Config saved', type: 'success' })
      savedSignatureRef.current = signatureOf({
        apiUrl: formToSave.apiUrl,
        spaceId: formToSave.spaceId,
        enabled: formToSave.enabled,
      })
      if (clearTimerRef.current) { clearTimeout(clearTimerRef.current) }
      clearTimerRef.current = setTimeout(setSaveState, 1600, 'idle')
    }
    catch (err) {
      if (saveRequestRef.current !== requestId) { return }
      const message = err instanceof Error ? err.message : String(err)
      setSaveState('error')
      ctx.notifications.show({ title: 'Save failed', description: message, type: 'error' })
    }
  }, [ctx.notifications, save])

  // Debounced auto-save when form changes
  useEffect(() => {
    if (!dirty || !config) { return }
    if (saveState === 'saving') { return }
    setSaveState('pending')
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current) }
    saveTimerRef.current = setTimeout(() => { void performSave(form) }, 1200)
    return () => {
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current) }
    }
  }, [dirty, config, form, performSave, saveState])

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current) }
      if (clearTimerRef.current) { clearTimeout(clearTimerRef.current) }
    }
  }, [])

  const setField = useCallback(<K extends keyof ConfigFormState>(key: K, value: ConfigFormState[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }, [])

  const handleReset = useCallback(() => {
    void refresh()
  }, [refresh])

  if (loading && !config) {
    return (
      <ScrollArea className="h-full">
        <div className="mx-auto flex max-w-2xl flex-col gap-3 p-6">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      </ScrollArea>
    )
  }

  if (error && !config) {
    return (
      <ScrollArea className="h-full">
        <div className="mx-auto flex max-w-2xl flex-col gap-3 p-6">
          <Alert variant="destructive">
            <AlertCircleIcon aria-hidden="true" />
            <AlertTitle>Couldn't load config</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button size="sm" variant="outline" className="self-start" onClick={() => void refresh()}>
            Retry
          </Button>
        </div>
      </ScrollArea>
    )
  }

  if (!config) { return null }

  return (
    <ScrollArea className="h-full" viewportClassName="max-h-full">
      <TooltipProvider>
      <div className="mx-auto flex max-w-2xl flex-col gap-2 p-6">
        {/* Status section */}
        <SettingsSectionHeader title="Nowledge Mem for Cradle" description="Official Cradle plugin for connecting agents to Nowledge Mem." />
        <SettingsRow
          label="Plugin"
          description={config.enabled ? 'Enabled — MCP registration runs on next sync.' : 'Disabled — server routes stay configured, but upstream work is skipped.'}
        >
          <Badge variant={config.enabled ? 'secondary' : 'outline'} className="gap-1">
            <Building2Line className={cn('size-3', config.enabled && 'animate-pulse')} aria-hidden="true" />
            {config.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </SettingsRow>
        <SettingsDivider />
        <SettingsRow
          label="API key"
          description="Read from NMEM_API_KEY in env or shared plugin config. Never persisted or returned."
        >
          <Badge variant={config.hasApiKey ? 'secondary' : 'outline'} className="gap-1">
            {config.hasApiKey && (
              <>
                <LockIcon className="size-3" aria-hidden="true" />
                Set
              </>
            )}
            {!config.hasApiKey && (
              <>
                <AlertCircleIcon className="size-3 !text-warning" aria-hidden="true" />
                Missing
              </>
            )}
          </Badge>
        </SettingsRow>
        <SettingsDivider />
        <SettingsRow
          label="MCP server"
          description="Streamable HTTP MCP endpoint registered server-side when enabled."
        >
          <code className="max-w-[280px] truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
            {deriveMcpUrl(form.apiUrl)}
          </code>
        </SettingsRow>

        {!config.hasApiKey && (
          <Alert className="mt-2">
            <AlertCircleIcon aria-hidden="true" />
            <AlertTitle>API key not configured</AlertTitle>
            <AlertDescription>
              <span>Set </span>
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">NMEM_API_KEY</code>
              <span> in the environment or shared plugin config. The plugin never persists or returns the key.</span>
            </AlertDescription>
          </Alert>
        )}

        {/* Connection section */}
        <div className="mt-4">
          <SettingsSectionHeader
            title="Connection"
            description="Non-secret settings stored in plugin-local storage."
          />
        </div>
        <SettingsRow
          label="API URL"
          description="Base URL of the Nowledge Mem API. Defaults to http://127.0.0.1:14242."
          info="Trailing slashes are stripped on save."
        >
          <Input
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={form.apiUrl}
            placeholder="http://127.0.0.1:14242"
            disabled={saveState === 'saving'}
            onChange={e => setField('apiUrl', e.target.value)}
          />
        </SettingsRow>
        <SettingsDivider />
        <SettingsRow
          label="MCP URL"
          description="Derived from the API URL. Read-only."
        >
          <Input
            type="url"
            value={deriveMcpUrl(form.apiUrl)}
            placeholder="http://127.0.0.1:14242/mcp"
            readOnly
            disabled
            className="font-mono text-[12px]"
          />
        </SettingsRow>
        <SettingsDivider />
        <SettingsRow
          label="Space ID"
          description="Optional default Nowledge space. Individual routes can override with space_id."
        >
          <Input
            autoComplete="off"
            spellCheck={false}
            value={form.spaceId}
            placeholder="default"
            disabled={saveState === 'saving'}
            onChange={e => setField('spaceId', e.target.value)}
          />
        </SettingsRow>
        <SettingsDivider />
        <SettingsRow
          label="Enabled"
          description="When off, upstream work and MCP registration are skipped on next activation."
        >
          <div className="flex items-center gap-2">
            <Switch
              checked={form.enabled}
              disabled={saveState === 'saving'}
              onCheckedChange={checked => setField('enabled', checked)}
            />
            <span className="text-[12px] text-muted-foreground tabular-nums">
              {form.enabled ? 'On' : 'Off'}
            </span>
          </div>
        </SettingsRow>

        {error && (
          <Alert variant="destructive" className="mt-2">
            <AlertCircleIcon aria-hidden="true" />
            <AlertTitle>Save failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Footer: SaveState + actions */}
        <div className="mt-2 flex items-center justify-between gap-2 pb-4">
          <SaveIndicator state={saveState} />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={!dirty || saveState === 'saving'}
            >
              Reset
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void performSave(form)}
              disabled={!dirty || saveState === 'saving'}
            >
              {saveState === 'saving' ? 'Saving...' : 'Save changes'}
            </Button>
          </div>
        </div>
      </div>
      </TooltipProvider>
    </ScrollArea>
  )
}

function signatureOf(form: { apiUrl: string, spaceId: string, enabled: boolean }): string {
  return JSON.stringify({
    apiUrl: form.apiUrl.trim(),
    spaceId: form.spaceId.trim(),
    enabled: form.enabled,
  })
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') { return null }
  return (
    <span
      className={cn(
        'flex items-center gap-1 text-[11px] font-medium transition-opacity duration-200',
        (state === 'saving' || state === 'pending') && 'text-muted-foreground',
        state === 'saved' && 'text-success',
        state === 'error' && 'text-destructive',
      )}
    >
      {(state === 'saving' || state === 'pending') && <Skeleton className="size-2.5 rounded-full" />}
      {state === 'saved' && <CheckCircleIcon className="size-3" aria-hidden="true" />}
      {state === 'error' && <AlertCircleIcon className="size-3" aria-hidden="true" />}
      <span>
        {state === 'pending' && 'Pending'}
        {state === 'saving' && 'Saving'}
        {state === 'saved' && 'Saved'}
        {state === 'error' && 'Save failed'}
      </span>
    </span>
  )
}
