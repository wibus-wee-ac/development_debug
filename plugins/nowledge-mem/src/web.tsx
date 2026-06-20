/* eslint-disable react-refresh/only-export-components -- plugin web entries export activate(), not only React components. */

import type { WebPluginContext } from '@cradle/plugin-sdk/web'
import {
  AlertLine as AlertCircleIcon,
  BookmarksLine as BookmarksIcon,
  BrainLine as BrainIcon,
  CheckCircleLine as CheckCircleIcon,
  CloudLine as CloudIcon,
  Link2Line as LinkIcon,
  LockLine as LockIcon,
  Refresh1Line as RefreshIcon,
  SaveLine as SaveIcon,
  Settings2Line as SettingsIcon,
} from '@mingcute/react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '~/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Separator } from '~/components/ui/separator'
import { Skeleton } from '~/components/ui/skeleton'
import { Switch } from '~/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'

interface NowledgePluginConfig {
  apiUrl: string
  mcpUrl?: string
  spaceId?: string
  enabled: boolean
  recallEnabled: false
  captureEnabled: false
  hasApiKey: boolean
}

interface ConfigFormState {
  apiUrl: string
  mcpUrl: string
  spaceId: string
  enabled: boolean
}

interface ConfigRouteSuccess {
  ok: true
  data: NowledgePluginConfig
}

interface ConfigRouteFailure {
  ok: false
  code: string
  message: string
}

type ConfigRouteResponse = ConfigRouteSuccess | ConfigRouteFailure

const DEFAULT_API_URL = 'http://127.0.0.1:14242'

const EMPTY_FORM: ConfigFormState = {
  apiUrl: '',
  mcpUrl: '',
  spaceId: '',
  enabled: true,
}

function toFormState(config: NowledgePluginConfig): ConfigFormState {
  return {
    apiUrl: config.apiUrl,
    mcpUrl: config.mcpUrl ?? deriveMcpUrl(config.apiUrl),
    spaceId: config.spaceId ?? '',
    enabled: config.enabled,
  }
}

async function readConfig(routes: WebPluginContext['routes']): Promise<NowledgePluginConfig> {
  const res = await routes.fetch('/config')
  const body = (await res.json()) as ConfigRouteResponse
  if (!res.ok || !body.ok) {
    throw new Error(body.ok === false ? body.message : `HTTP ${res.status}`)
  }
  return body.data
}

async function writeConfig(
  routes: WebPluginContext['routes'],
  form: ConfigFormState,
): Promise<NowledgePluginConfig> {
  const res = await routes.fetch('/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      apiUrl: form.apiUrl.trim() || undefined,
      mcpUrl: deriveMcpUrl(form.apiUrl.trim() || DEFAULT_API_URL),
      spaceId: form.spaceId.trim() || null,
      enabled: form.enabled,
    }),
  })
  const body = (await res.json()) as ConfigRouteResponse
  if (!res.ok || !body.ok) {
    throw new Error(body.ok === false ? body.message : `HTTP ${res.status}`)
  }
  return body.data
}

function deriveMcpUrl(apiUrl: string): string {
  return `${apiUrl.trim().replace(/\/+$/, '') || DEFAULT_API_URL}/mcp`
}

function LoadingPanel() {
  return (
    <div className="flex h-full min-h-72 flex-col gap-3 p-3">
      <Card size="sm" className="shrink-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Skeleton className="size-8 rounded-lg" />
            <Skeleton className="h-4 w-32" />
          </CardTitle>
          <CardDescription>
            <Skeleton className="h-3 w-48" />
          </CardDescription>
        </CardHeader>
      </Card>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  )
}

function ErrorPanel({ error, onRefresh }: { error: string, onRefresh: () => void }) {
  return (
    <div className="flex h-full min-h-72 flex-col gap-3 p-3">
      <Alert variant="destructive">
        <AlertCircleIcon aria-hidden="true" />
        <AlertTitle>Couldn't load Nowledge config</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
      <Button type="button" size="sm" variant="outline" className="self-start" onClick={onRefresh}>
        <RefreshIcon aria-hidden="true" />
        Retry
      </Button>
    </div>
  )
}

function ConfigField({
  id,
  label,
  description,
  icon: Icon,
  children,
}: {
  id: string
  label: string
  description: string
  icon: typeof CloudIcon
  children: React.ReactNode
}) {
  return (
    <Field orientation="vertical">
      <FieldLabel htmlFor={id} className="flex items-center gap-2">
        <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        {label}
      </FieldLabel>
      {children}
      <FieldDescription>{description}</FieldDescription>
    </Field>
  )
}

function NowledgeConfigPanel({
  isActive,
  routes,
  notifications,
}: {
  isActive: boolean
  routes: WebPluginContext['routes']
  notifications: WebPluginContext['notifications']
}) {
  const [config, setConfig] = useState<NowledgePluginConfig | null>(null)
  const [form, setForm] = useState<ConfigFormState>(EMPTY_FORM)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await readConfig(routes)
      setConfig(next)
      setForm(toFormState(next))
      setSavedAt(null)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setLoading(false)
    }
  }, [routes])

  useEffect(() => {
    if (!isActive) { return }
    queueMicrotask(() => void refresh())
  }, [isActive, refresh])

  const dirty = useMemo(() => {
    if (!config) { return false }
    return (
      form.apiUrl !== config.apiUrl
      || (form.spaceId || '') !== (config.spaceId ?? '')
      || form.enabled !== config.enabled
    )
  }, [config, form])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const next = await writeConfig(routes, form)
      setConfig(next)
      setForm(toFormState(next))
      setSavedAt(new Date())
      notifications.show({
        title: 'Nowledge config saved',
        type: 'success',
        description: 'apiUrl, mcpUrl, spaceId, and enabled were updated.',
      })
    }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      notifications.show({ title: 'Nowledge config save failed', description: message, type: 'error' })
    }
    finally {
      setSaving(false)
    }
  }, [form, notifications, routes])

  const handleReset = useCallback(() => {
    if (!config) { return }
    setForm(toFormState(config))
    setError(null)
    setSavedAt(null)
  }, [config])

  if (loading && !config) {
    return (
      <TooltipProvider>
        <LoadingPanel />
      </TooltipProvider>
    )
  }
  if (error && !config) {
    return (
      <TooltipProvider>
        <ErrorPanel error={error} onRefresh={() => void refresh()} />
      </TooltipProvider>
    )
  }
  if (!config) {
    return (
      <TooltipProvider>
        <ErrorPanel error="No config loaded" onRefresh={() => void refresh()} />
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider>
      <ScrollArea className="h-full" viewportClassName="max-h-full" contentClassName="min-w-0 p-3">
        <div className="flex min-w-0 flex-col gap-3">
          <Card size="sm" className="shrink-0">
            <CardHeader>
              <CardTitle className="flex min-w-0 items-center gap-2 text-balance">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <BrainIcon className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 truncate">Nowledge Mem</span>
              </CardTitle>
              <CardDescription className="text-pretty">
                Plugin-owned settings. The MCP endpoint is derived from the API URL.
              </CardDescription>
              <CardAction>
                <Tooltip>
                  <TooltipTrigger
                    render={(
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        onClick={() => void refresh()}
                        disabled={loading || saving}
                        aria-label="Refresh Nowledge config"
                      >
                        <RefreshIcon
                          className={loading ? 'size-3.5 animate-spin' : 'size-3.5'}
                          aria-hidden="true"
                        />
                      </Button>
                    )}
                  />
                  <TooltipContent>Refresh from server</TooltipContent>
                </Tooltip>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={config.enabled ? 'secondary' : 'outline'}>
                  {config.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
                <Badge variant={config.hasApiKey ? 'secondary' : 'outline'}>
                  {config.hasApiKey
                    ? (
                        <>
                          <LockIcon aria-hidden="true" />
                          API key set
                        </>
                      )
                    : (
                        <>
                          <AlertCircleIcon aria-hidden="true" />
                          API key missing
                        </>
                      )}
                </Badge>
                {savedAt && (
                  <Badge variant="outline">
                    <CheckCircleIcon aria-hidden="true" />
                    Saved
                  </Badge>
                )}
              </div>
              {!config.hasApiKey && (
                <Alert>
                  <AlertCircleIcon aria-hidden="true" />
                  <AlertTitle>API key not configured</AlertTitle>
                  <AlertDescription>
                    Set
                    {' '}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">NMEM_API_KEY</code>
                    {' '}
                    in the environment or shared plugin config. The plugin never persists or returns the key.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <SettingsIcon className="size-4" aria-hidden="true" />
                Connection
              </CardTitle>
              <CardDescription>
                Non-secret settings stored in plugin-local storage. PUT /config updates them.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ConfigField
                id="nowledge-api-url"
                label="API URL"
                description="Base URL of the Nowledge Mem API. Defaults to http://127.0.0.1:14242."
                icon={CloudIcon}
              >
                <Input
                  id="nowledge-api-url"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={form.apiUrl}
                  placeholder="http://127.0.0.1:14242"
                  disabled={saving}
                  onChange={event => setForm(prev => ({ ...prev, apiUrl: event.target.value }))}
                />
              </ConfigField>

              <Separator />

              <ConfigField
                id="nowledge-mcp-url"
                label="MCP URL"
                description="Streamable HTTP MCP endpoint derived from the API URL."
                icon={LinkIcon}
              >
                <Input
                  id="nowledge-mcp-url"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={deriveMcpUrl(form.apiUrl)}
                  placeholder="http://127.0.0.1:14242/mcp"
                  readOnly
                  disabled={saving}
                />
              </ConfigField>

              <Separator />

              <ConfigField
                id="nowledge-space-id"
                label="Space ID"
                description="Optional default Nowledge space. Individual routes can override with space_id."
                icon={BookmarksIcon}
              >
                <Input
                  id="nowledge-space-id"
                  autoComplete="off"
                  spellCheck={false}
                  value={form.spaceId}
                  placeholder="default"
                  disabled={saving}
                  onChange={event => setForm(prev => ({ ...prev, spaceId: event.target.value }))}
                />
              </ConfigField>

              <Separator />

              <Field orientation="horizontal">
                <FieldLabel htmlFor="nowledge-enabled" className="flex items-center gap-2">
                  <SettingsIcon className="size-3.5 !text-muted-foreground" aria-hidden="true" />
                  Enabled
                </FieldLabel>
                <div className="flex items-center gap-2">
                  <Switch
                    id="nowledge-enabled"
                    checked={form.enabled}
                    disabled={saving}
                    onCheckedChange={checked => setForm(prev => ({ ...prev, enabled: checked }))}
                  />
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {form.enabled ? 'On' : 'Off'}
                  </span>
                </div>
                <FieldDescription className="basis-full">
                  When off, /status skips the upstream probe and MCP registration is skipped on next activation.
                </FieldDescription>
              </Field>
            </CardContent>
          </Card>

          {error && (
            <Alert variant="destructive">
              <AlertCircleIcon aria-hidden="true" />
              <AlertTitle>Save failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center justify-end gap-2 pb-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={!dirty || saving}
            >
              Reset
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleSave()}
              disabled={!dirty || saving}
            >
              <SaveIcon aria-hidden="true" />
              {saving ? 'Saving...' : 'Save changes'}
            </Button>
          </div>
        </div>
      </ScrollArea>
    </TooltipProvider>
  )
}

export function activate(ctx: WebPluginContext): void {
  ctx.panels.register({
    id: 'config',
    title: 'Nowledge Mem',
    component: props => (
      <NowledgeConfigPanel
        {...props}
        routes={ctx.routes}
        notifications={ctx.notifications}
      />
    ),
    location: 'sidebar',
  })

  ctx.logger.info('Nowledge Mem plugin (web) activated')
}
