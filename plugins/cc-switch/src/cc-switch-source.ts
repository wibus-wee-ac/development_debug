/* Reads CC Switch local provider data and maps it into Cradle external provider snapshots. */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

import Database from 'better-sqlite3'
import { parse as parseToml } from 'smol-toml'
import type {
  ExternalProviderRecord,
  ExternalProviderSource,
  ExternalProviderSourceReadContext,
  ExternalProviderSourceSnapshot,
  ExternalProviderWarning,
} from '@cradle/plugin-sdk/server'

type JsonObject = Record<string, unknown>

interface CcSwitchSourceConfig {
  appConfigDir: string
  dbPath: string
  settingsPath: string
}

interface CcSwitchProviderRow {
  id: string
  appType: string
  name: string
  settingsConfig: JsonObject
  settingsConfigRaw: string
  websiteUrl: string | null
  category: string | null
  createdAt: number | null
  sortIndex: number | null
  notes: string | null
  icon: string | null
  iconColor: string | null
  meta: JsonObject
  metaRaw: string
  isCurrent: boolean
  inFailoverQueue: boolean
  endpoints: Array<{ url: string, addedAt: number | null }>
  health: 'healthy' | 'unhealthy' | 'unknown'
}

interface CcSwitchSnapshotReadResult {
  providers: CcSwitchProviderRow[]
  inventory: {
    mcpServers?: number
    prompts?: number
    skills?: number
    usageRollups?: number
    modelPricingEntries?: number
  }
  warnings: ExternalProviderWarning[]
}

const CURRENT_PROVIDER_KEYS: Record<string, string> = {
  claude: 'currentProviderClaude',
  'claude-desktop': 'currentProviderClaudeDesktop',
  codex: 'currentProviderCodex',
  gemini: 'currentProviderGemini',
  opencode: 'currentProviderOpenCode',
  openclaw: 'currentProviderOpenClaw',
  hermes: 'currentProviderHermes',
}

const SUPPORTED_APPS = new Set(['claude', 'codex', 'gemini'])

function textHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function booleanFromSql(value: unknown): boolean {
  return value === true || value === 1
}

function parseJsonObject(raw: string | null | undefined): JsonObject {
  if (!raw) return {}
  try {
    return objectValue(JSON.parse(raw))
  }
  catch {
    return {}
  }
}

function readJsonObject(path: string): JsonObject {
  if (!existsSync(path)) return {}
  try {
    return objectValue(JSON.parse(readFileSync(path, 'utf8')))
  }
  catch {
    return {}
  }
}

function configValue(ctx: ExternalProviderSourceReadContext | null, key: string, fallback: string): string {
  return ctx?.sharedConfig.get(key) ?? process.env[`CRADLE_${key}`] ?? process.env[key] ?? fallback
}

export function resolveCcSwitchSourceConfig(ctx: ExternalProviderSourceReadContext | null = null): CcSwitchSourceConfig {
  const defaultDir = join(homedir(), '.cc-switch')
  const appConfigDir = configValue(ctx, 'CC_SWITCH_APP_CONFIG_DIR', defaultDir)
  return {
    appConfigDir,
    dbPath: configValue(ctx, 'CC_SWITCH_DB_PATH', join(appConfigDir, 'cc-switch.db')),
    settingsPath: configValue(ctx, 'CC_SWITCH_SETTINGS_PATH', join(appConfigDir, 'settings.json')),
  }
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db.prepare("SELECT 1 AS exists_flag FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1").get(tableName)
  return Boolean(row)
}

function tableColumns(db: Database.Database, tableName: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
  return new Set(rows.map(row => row.name))
}

function columnSelect(columns: Set<string>, name: string, fallback: string): string {
  return columns.has(name) ? name : `${fallback} AS ${name}`
}

function countRows(db: Database.Database, tableName: string): number | undefined {
  if (!tableExists(db, tableName)) return undefined
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number }
  return row.count
}

function readEndpoints(db: Database.Database): Map<string, Array<{ url: string, addedAt: number | null }>> {
  if (!tableExists(db, 'provider_endpoints')) return new Map()
  const rows = db.prepare('SELECT provider_id, app_type, url, added_at FROM provider_endpoints ORDER BY added_at ASC, url ASC').all() as Array<{
    provider_id: string
    app_type: string
    url: string
    added_at: number | null
  }>
  const endpoints = new Map<string, Array<{ url: string, addedAt: number | null }>>()
  for (const row of rows) {
    const key = `${row.app_type}\0${row.provider_id}`
    const current = endpoints.get(key) ?? []
    current.push({ url: row.url, addedAt: row.added_at ?? null })
    endpoints.set(key, current)
  }
  return endpoints
}

function readHealth(db: Database.Database): Map<string, 'healthy' | 'unhealthy' | 'unknown'> {
  if (!tableExists(db, 'provider_health')) return new Map()
  const rows = db.prepare('SELECT provider_id, app_type, is_healthy FROM provider_health').all() as Array<{
    provider_id: string
    app_type: string
    is_healthy: number
  }>
  return new Map(rows.map(row => [`${row.app_type}\0${row.provider_id}`, booleanFromSql(row.is_healthy) ? 'healthy' : 'unhealthy']))
}

function effectiveCurrentIds(providers: CcSwitchProviderRow[], localSettings: JsonObject): Map<string, string | null> {
  const byApp = new Map<string, Set<string>>()
  for (const provider of providers) {
    const ids = byApp.get(provider.appType) ?? new Set<string>()
    ids.add(provider.id)
    byApp.set(provider.appType, ids)
  }

  const currentIds = new Map<string, string | null>()
  for (const appType of byApp.keys()) {
    const settingsKey = CURRENT_PROVIDER_KEYS[appType]
    const localCurrent = settingsKey ? stringValue(localSettings[settingsKey]) : undefined
    if (localCurrent && byApp.get(appType)?.has(localCurrent)) {
      currentIds.set(appType, localCurrent)
      continue
    }
    currentIds.set(appType, providers.find(provider => provider.appType === appType && provider.isCurrent)?.id ?? null)
  }
  return currentIds
}

function readProviderRows(db: Database.Database, settingsPath: string): CcSwitchProviderRow[] {
  if (!tableExists(db, 'providers')) {
    throw new Error('CC Switch database is missing providers table')
  }

  const columns = tableColumns(db, 'providers')
  for (const requiredColumn of ['id', 'app_type', 'name', 'settings_config']) {
    if (!columns.has(requiredColumn)) {
      throw new Error(`CC Switch providers table is missing required column ${requiredColumn}`)
    }
  }

  const endpoints = readEndpoints(db)
  const health = readHealth(db)
  const rows = db.prepare(`
    SELECT
      id,
      app_type,
      name,
      settings_config,
      ${columnSelect(columns, 'website_url', 'NULL')},
      ${columnSelect(columns, 'category', 'NULL')},
      ${columnSelect(columns, 'created_at', 'NULL')},
      ${columnSelect(columns, 'sort_index', 'NULL')},
      ${columnSelect(columns, 'notes', 'NULL')},
      ${columnSelect(columns, 'icon', 'NULL')},
      ${columnSelect(columns, 'icon_color', 'NULL')},
      ${columnSelect(columns, 'meta', "'{}'")},
      ${columnSelect(columns, 'is_current', '0')},
      ${columnSelect(columns, 'in_failover_queue', '0')}
    FROM providers
    ORDER BY app_type ASC, COALESCE(sort_index, 999999), created_at ASC, id ASC
  `).all() as Array<Record<string, unknown>>

  const providers = rows.map(row => ({
    id: String(row.id),
    appType: String(row.app_type),
    name: String(row.name),
    settingsConfig: parseJsonObject(String(row.settings_config ?? '{}')),
    settingsConfigRaw: String(row.settings_config ?? '{}'),
    websiteUrl: stringValue(row.website_url) ?? null,
    category: stringValue(row.category) ?? null,
    createdAt: numberValue(row.created_at),
    sortIndex: numberValue(row.sort_index),
    notes: stringValue(row.notes) ?? null,
    icon: stringValue(row.icon) ?? null,
    iconColor: stringValue(row.icon_color) ?? null,
    meta: parseJsonObject(String(row.meta ?? '{}')),
    metaRaw: String(row.meta ?? '{}'),
    isCurrent: booleanFromSql(row.is_current),
    inFailoverQueue: booleanFromSql(row.in_failover_queue),
    endpoints: endpoints.get(`${row.app_type}\0${row.id}`) ?? [],
    health: health.get(`${row.app_type}\0${row.id}`) ?? 'unknown',
  }))

  const currentIds = effectiveCurrentIds(providers, readJsonObject(settingsPath))
  return providers.map(provider => ({
    ...provider,
    isCurrent: currentIds.get(provider.appType) === provider.id,
  }))
}

export function readCcSwitchSnapshot(config: CcSwitchSourceConfig): CcSwitchSnapshotReadResult {
  if (!existsSync(config.dbPath)) {
    throw new Error(`CC Switch database not found at ${config.dbPath}`)
  }

  const db = new Database(config.dbPath, { readonly: true, fileMustExist: true })
  try {
    db.pragma('query_only = ON')
    db.pragma('busy_timeout = 1000')
    const providers = readProviderRows(db, config.settingsPath)
    return {
      providers,
      inventory: {
        mcpServers: countRows(db, 'mcp_servers'),
        prompts: countRows(db, 'prompts'),
        skills: countRows(db, 'skills'),
        usageRollups: countRows(db, 'usage_daily_rollups'),
        modelPricingEntries: countRows(db, 'model_pricing'),
      },
      warnings: [],
    }
  }
  finally {
    db.close()
  }
}

function metadataBase(provider: CcSwitchProviderRow): JsonObject {
  return {
    appType: provider.appType,
    category: provider.category,
    current: provider.isCurrent,
    health: provider.health,
    inFailoverQueue: provider.inFailoverQueue,
    sourceUpdatedAt: provider.createdAt ? new Date(provider.createdAt).toISOString() : undefined,
    rawFingerprintHint: textHash({
      id: provider.id,
      appType: provider.appType,
      settingsConfig: provider.settingsConfigRaw,
      meta: provider.metaRaw,
      endpoints: provider.endpoints,
      current: provider.isCurrent,
    }),
  }
}

function mapClaudeProvider(provider: CcSwitchProviderRow): ExternalProviderRecord | null {
  const env = objectValue(provider.settingsConfig.env)
  const baseUrl = stringValue(env.ANTHROPIC_BASE_URL)
  const model = stringValue(env.ANTHROPIC_MODEL)
    ?? stringValue(env.ANTHROPIC_DEFAULT_SONNET_MODEL)
    ?? stringValue(env.ANTHROPIC_DEFAULT_OPUS_MODEL)
    ?? stringValue(env.ANTHROPIC_DEFAULT_HAIKU_MODEL)
  const credential = stringValue(env.ANTHROPIC_AUTH_TOKEN) ?? stringValue(env.ANTHROPIC_API_KEY)
  const modelAliases = {
    haiku: stringValue(env.ANTHROPIC_DEFAULT_HAIKU_MODEL),
    sonnet: stringValue(env.ANTHROPIC_DEFAULT_SONNET_MODEL),
    opus: stringValue(env.ANTHROPIC_DEFAULT_OPUS_MODEL),
  }

  return {
    externalId: `cc-switch:${provider.appType}:${provider.id}`,
    app: provider.appType,
    name: `CC Switch / Claude / ${provider.name}`,
    providerKind: 'anthropic',
    config: {
      baseUrl,
    },
    credential: credential ? { kind: 'api-key', value: credential, label: provider.name } : undefined,
    current: provider.isCurrent,
    metadata: {
      ...metadataBase(provider),
      baseUrl,
      model,
      apiFormat: stringValue(provider.meta.apiFormat) ?? 'anthropic',
    },
  }
}

function mapCodexProvider(provider: CcSwitchProviderRow): ExternalProviderRecord | null {
  const auth = objectValue(provider.settingsConfig.auth)
  const configText = stringValue(provider.settingsConfig.config)
  if (!configText) return null

  let parsedToml: JsonObject
  try {
    parsedToml = objectValue(parseToml(configText))
  }
  catch {
    return null
  }

  const activeProviderId = stringValue(parsedToml.model_provider)
  const providerConfigs = objectValue(parsedToml.model_providers)
  const activeProvider = activeProviderId ? objectValue(providerConfigs[activeProviderId]) : {}
  const baseUrl = stringValue(activeProvider.base_url)
  const model = stringValue(parsedToml.model)
  const reasoningEffort = stringValue(parsedToml.model_reasoning_effort)
  const wireApi = stringValue(activeProvider.wire_api)
  const credential = stringValue(auth.OPENAI_API_KEY)

  return {
    externalId: `cc-switch:${provider.appType}:${provider.id}`,
    app: provider.appType,
    name: `CC Switch / Codex / ${provider.name}`,
    providerKind: 'openai-compatible',
    config: {
      baseUrl,
    },
    credential: credential ? { kind: 'api-key', value: credential, label: provider.name } : undefined,
    current: provider.isCurrent,
    metadata: {
      ...metadataBase(provider),
      baseUrl,
      model,
      apiFormat: wireApi === 'responses' ? 'openai_responses' : 'openai_chat',
    },
  }
}

function mapGeminiProvider(provider: CcSwitchProviderRow): ExternalProviderRecord | null {
  const env = objectValue(provider.settingsConfig.env)
  const baseUrl = stringValue(env.GOOGLE_GEMINI_BASE_URL)
  const model = stringValue(env.GEMINI_MODEL)
  const credential = stringValue(env.GEMINI_API_KEY)
  const apiFormat = stringValue(provider.meta.apiFormat)
  const isNativeGoogle = baseUrl ? /generativelanguage\.googleapis\.com/i.test(baseUrl) : true
  const isOpenAiCompatible = apiFormat === 'openai_chat' || apiFormat === 'openai_responses' || !isNativeGoogle
  if (!isOpenAiCompatible) return null

  return {
    externalId: `cc-switch:${provider.appType}:${provider.id}`,
    app: provider.appType,
    name: `CC Switch / Gemini / ${provider.name}`,
    providerKind: 'openai-compatible',
    config: {
      baseUrl,
    },
    credential: credential ? { kind: 'api-key', value: credential, label: provider.name } : undefined,
    current: provider.isCurrent,
    metadata: {
      ...metadataBase(provider),
      baseUrl,
      model,
      apiFormat: apiFormat ?? 'openai_chat',
    },
  }
}

function mapProvider(provider: CcSwitchProviderRow): ExternalProviderRecord | null {
  if (provider.appType === 'claude') return mapClaudeProvider(provider)
  if (provider.appType === 'codex') return mapCodexProvider(provider)
  if (provider.appType === 'gemini') return mapGeminiProvider(provider)
  return null
}

function unsupportedWarnings(providers: CcSwitchProviderRow[]): ExternalProviderWarning[] {
  const warnings: ExternalProviderWarning[] = []
  const unsupportedApps = new Map<string, number>()
  for (const provider of providers) {
    if (SUPPORTED_APPS.has(provider.appType)) continue
    unsupportedApps.set(provider.appType, (unsupportedApps.get(provider.appType) ?? 0) + 1)
  }
  for (const [appType, count] of unsupportedApps) {
    warnings.push({
      code: 'cc-switch-app-unsupported',
      message: `${count} ${appType} provider${count === 1 ? '' : 's'} detected but not projected by this plugin version.`,
      severity: 'info',
    })
  }
  return warnings
}

export async function readCcSwitchExternalProviderSnapshot(ctx: ExternalProviderSourceReadContext): Promise<ExternalProviderSourceSnapshot> {
  const config = resolveCcSwitchSourceConfig(ctx)
  const snapshot = readCcSwitchSnapshot(config)
  const skippedWarnings: ExternalProviderWarning[] = []
  const providers = snapshot.providers.flatMap(provider => {
    const record = mapProvider(provider)
    if (!record && SUPPORTED_APPS.has(provider.appType)) {
      skippedWarnings.push({
        code: 'cc-switch-provider-unsupported-runtime',
        message: `${provider.appType} provider "${provider.name}" was detected but cannot be projected to a Cradle runtime yet.`,
        severity: 'info',
      })
    }
    return record ? [record] : []
  })
  const warnings = [...snapshot.warnings, ...unsupportedWarnings(snapshot.providers), ...skippedWarnings]

  return {
    source: {
      status: warnings.some(warning => warning.severity === 'error') ? 'error' : warnings.some(warning => warning.severity === 'warning') ? 'warning' : 'ok',
      message: `Read ${snapshot.providers.length} CC Switch providers from ${config.dbPath}`,
      observedAt: new Date().toISOString(),
    },
    inventory: snapshot.inventory,
    warnings,
    providers,
  }
}

export function createCcSwitchExternalProviderSource(): ExternalProviderSource {
  return {
    id: 'cc-switch',
    label: 'CC Switch',
    description: 'Reads CC Switch provider settings and mirrors supported providers into Cradle.',
    capabilities: { refresh: true, revealSourceFile: true },
    readSnapshot: readCcSwitchExternalProviderSnapshot,
  }
}
