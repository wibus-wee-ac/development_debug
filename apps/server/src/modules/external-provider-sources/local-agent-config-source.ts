// Output: Local Claude and Codex config reader for onboarding external provider snapshots.
// Input: Allowlisted local config files and optional process environment values.
// Position: External provider source utilities owned by Cradle onboarding/provider integration.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type {
  ExternalProviderRecord,
  ExternalProviderSource,
  ExternalProviderSourceReadContext,
  ExternalProviderSourceSnapshot,
  ExternalProviderWarning
} from '@cradle/plugin-sdk/server'
import { parse as parseToml } from 'smol-toml'
import { z } from 'zod'

type JsonObject = Record<string, unknown>

const OptionalStringSchema = z.preprocess((value) => {
  if (value === null || value === undefined) {
    return undefined
  }
  if (typeof value === 'string' && value.trim().length === 0) {
    return undefined
  }
  return value
}, z.string().trim().min(1).optional())

const ClaudeEnvSchema = z.object({
  ANTHROPIC_BASE_URL: OptionalStringSchema,
  ANTHROPIC_AUTH_TOKEN: OptionalStringSchema,
  ANTHROPIC_API_KEY: OptionalStringSchema,
  ANTHROPIC_MODEL: OptionalStringSchema,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: OptionalStringSchema,
  ANTHROPIC_DEFAULT_SONNET_MODEL: OptionalStringSchema,
  ANTHROPIC_DEFAULT_OPUS_MODEL: OptionalStringSchema
}).catchall(z.unknown())

const ClaudeSettingsSchema = z.object({
  env: ClaudeEnvSchema.optional().default({})
}).passthrough()

const CodexAuthSchema = z.object({
  OPENAI_API_KEY: OptionalStringSchema,
  apiKey: OptionalStringSchema,
  api_key: OptionalStringSchema
}).catchall(z.unknown())

const CodexModelProviderSchema = z.object({
  base_url: OptionalStringSchema,
  wire_api: OptionalStringSchema
}).passthrough()

const CodexTomlSchema = z.object({
  model_provider: OptionalStringSchema,
  model: OptionalStringSchema,
  model_reasoning_effort: OptionalStringSchema,
  approval_policy: OptionalStringSchema,
  sandbox_mode: OptionalStringSchema,
  openai_base_url: OptionalStringSchema,
  model_providers: z.record(z.string(), CodexModelProviderSchema).default({})
}).passthrough()

const ReasoningEffortSchema = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh'])
const ApprovalPolicySchema = z.enum(['never', 'on-request', 'on-failure', 'untrusted'])
const SandboxModeSchema = z.enum(['read-only', 'workspace-write', 'danger-full-access'])

interface ClaudeConfigReadResult {
  settingsPath: string
  localSettingsPath: string
  settingsFound: boolean
  localSettingsFound: boolean
  env: z.infer<typeof ClaudeEnvSchema>
  warnings: ExternalProviderWarning[]
}

interface CodexConfigReadResult {
  configPath: string
  authPath: string
  configFound: boolean
  authFound: boolean
  config: z.infer<typeof CodexTomlSchema>
  auth: z.infer<typeof CodexAuthSchema>
  warnings: ExternalProviderWarning[]
}

export interface LocalAgentConfigSourceConfig {
  claudeDir: string
  claudeSettingsPath: string
  claudeLocalSettingsPath: string
  codexDir: string
  codexConfigPath: string
  codexAuthPath: string
  includeProcessEnv: boolean
}

interface ReadJsonResult<T> {
  found: boolean
  value: T | null
  warning: ExternalProviderWarning | null
}

const DEFAULT_SOURCE_ID = 'local-agent-config'
const DEFAULT_SOURCE_LABEL = 'Local Agent Config'

function hashText(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sourceConfigValue(ctx: ExternalProviderSourceReadContext | null, key: string, fallback: string): string {
  return ctx?.sharedConfig.get(key) ?? process.env[`CRADLE_${key}`] ?? process.env[key] ?? fallback
}

function sourceConfigFlag(ctx: ExternalProviderSourceReadContext | null, key: string, fallback: boolean): boolean {
  const value = ctx?.sharedConfig.get(key) ?? process.env[`CRADLE_${key}`] ?? process.env[key]
  if (value === undefined) {
    return fallback
  }
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

export function resolveLocalAgentConfigSourceConfig(ctx: ExternalProviderSourceReadContext | null = null): LocalAgentConfigSourceConfig {
  const claudeDir = sourceConfigValue(ctx, 'LOCAL_AGENT_CONFIG_CLAUDE_DIR', join(homedir(), '.claude'))
  const codexDir = sourceConfigValue(ctx, 'LOCAL_AGENT_CONFIG_CODEX_DIR', join(homedir(), '.codex'))
  return {
    claudeDir,
    claudeSettingsPath: sourceConfigValue(ctx, 'LOCAL_AGENT_CONFIG_CLAUDE_SETTINGS_PATH', join(claudeDir, 'settings.json')),
    claudeLocalSettingsPath: sourceConfigValue(ctx, 'LOCAL_AGENT_CONFIG_CLAUDE_LOCAL_SETTINGS_PATH', join(claudeDir, 'settings.local.json')),
    codexDir,
    codexConfigPath: sourceConfigValue(ctx, 'LOCAL_AGENT_CONFIG_CODEX_CONFIG_PATH', join(codexDir, 'config.toml')),
    codexAuthPath: sourceConfigValue(ctx, 'LOCAL_AGENT_CONFIG_CODEX_AUTH_PATH', join(codexDir, 'auth.json')),
    includeProcessEnv: sourceConfigFlag(ctx, 'LOCAL_AGENT_CONFIG_INCLUDE_PROCESS_ENV', true)
  }
}

function readJsonFile<T>(path: string, schema: z.ZodType<T>, warningCode: string, label: string): ReadJsonResult<T> {
  if (!existsSync(path)) {
    return { found: false, value: null, warning: null }
  }

  try {
    return {
      found: true,
      value: z.string()
        .transform((raw) => JSON.parse(raw))
        .pipe(schema)
        .parse(readFileSync(path, 'utf8')),
      warning: null
    }
  } catch (error) {
    return {
      found: true,
      value: null,
      warning: {
        code: warningCode,
        message: `${label} could not be parsed. ${errorMessage(error)}`,
        severity: 'warning'
      }
    }
  }
}

function readTomlFile<T>(path: string, schema: z.ZodType<T>, warningCode: string, label: string): ReadJsonResult<T> {
  if (!existsSync(path)) {
    return { found: false, value: null, warning: null }
  }

  try {
    return {
      found: true,
      value: schema.parse(parseToml(readFileSync(path, 'utf8'))),
      warning: null
    }
  } catch (error) {
    return {
      found: true,
      value: null,
      warning: {
        code: warningCode,
        message: `${label} could not be parsed. ${errorMessage(error)}`,
        severity: 'warning'
      }
    }
  }
}

function readClaudeConfig(config: LocalAgentConfigSourceConfig): ClaudeConfigReadResult {
  const settings = readJsonFile(config.claudeSettingsPath, ClaudeSettingsSchema, 'local-claude-settings-invalid', 'Claude settings')
  const localSettings = readJsonFile(
    config.claudeLocalSettingsPath,
    ClaudeSettingsSchema,
    'local-claude-local-settings-invalid',
    'Claude local settings'
  )

  const processEnv = config.includeProcessEnv
    ? ClaudeEnvSchema.parse(process.env)
    : {}
  const env = ClaudeEnvSchema.parse({
    ...settings.value?.env,
    ...localSettings.value?.env,
    ...processEnv
  })
  const warnings = [settings.warning, localSettings.warning].filter((warning): warning is ExternalProviderWarning => Boolean(warning))

  return {
    settingsPath: config.claudeSettingsPath,
    localSettingsPath: config.claudeLocalSettingsPath,
    settingsFound: settings.found,
    localSettingsFound: localSettings.found,
    env,
    warnings
  }
}

function readCodexConfig(config: LocalAgentConfigSourceConfig): CodexConfigReadResult {
  const codexConfig = readTomlFile(config.codexConfigPath, CodexTomlSchema, 'local-codex-config-invalid', 'Codex config')
  const codexAuth = readJsonFile(config.codexAuthPath, CodexAuthSchema, 'local-codex-auth-invalid', 'Codex auth')
  const processAuth = config.includeProcessEnv
    ? CodexAuthSchema.parse(process.env)
    : {}
  const warnings = [codexConfig.warning, codexAuth.warning].filter((warning): warning is ExternalProviderWarning => Boolean(warning))

  return {
    configPath: config.codexConfigPath,
    authPath: config.codexAuthPath,
    configFound: codexConfig.found,
    authFound: codexAuth.found,
    config: CodexTomlSchema.parse(codexConfig.value ?? {}),
    auth: CodexAuthSchema.parse({
      ...codexAuth.value,
      ...processAuth
    }),
    warnings
  }
}

function compactRecord(value: JsonObject): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

function maybeEnum<T extends z.ZodEnum>(schema: T, value: string | undefined): z.infer<T> | undefined {
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function claudeRecord(input: ClaudeConfigReadResult): ExternalProviderRecord | null {
  const apiKey = input.env.ANTHROPIC_AUTH_TOKEN ?? input.env.ANTHROPIC_API_KEY
  const modelAliases = compactRecord({
    haiku: input.env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
    sonnet: input.env.ANTHROPIC_DEFAULT_SONNET_MODEL,
    opus: input.env.ANTHROPIC_DEFAULT_OPUS_MODEL
  })
  const hasAlias = Object.keys(modelAliases).length > 0
  const hasSignal = input.settingsFound
    || input.localSettingsFound
    || Boolean(input.env.ANTHROPIC_BASE_URL)
    || Boolean(input.env.ANTHROPIC_MODEL)
    || Boolean(apiKey)
    || hasAlias

  if (!hasSignal) {
    return null
  }

  return {
    externalId: 'claude:local-current',
    app: 'claude',
    name: 'Local Claude',
    providerKind: 'anthropic',
    config: compactRecord({
      baseUrl: input.env.ANTHROPIC_BASE_URL,
      model: input.env.ANTHROPIC_MODEL,
      claudeAgent: hasAlias ? { modelAliases } : undefined
    }),
    credential: apiKey ? { kind: 'api-key', value: apiKey, label: 'Local Claude' } : undefined,
    current: true,
    metadata: compactRecord({
      baseUrl: input.env.ANTHROPIC_BASE_URL,
      model: input.env.ANTHROPIC_MODEL,
      apiFormat: 'anthropic',
      rawFingerprintHint: hashText({
        settingsFound: input.settingsFound,
        localSettingsFound: input.localSettingsFound,
        baseUrl: input.env.ANTHROPIC_BASE_URL,
        model: input.env.ANTHROPIC_MODEL,
        modelAliases,
        hasCredential: Boolean(apiKey)
      })
    }),
    warnings: apiKey
      ? []
      : [{
          code: 'local-claude-credential-missing',
          message: 'No Claude API key was found in the allowlisted local config or process environment.',
          severity: 'info'
        }]
  }
}

function codexRecord(input: CodexConfigReadResult): ExternalProviderRecord | null {
  const providerId = input.config.model_provider
  const activeProvider = providerId ? input.config.model_providers[providerId] : undefined
  const baseUrl = activeProvider?.base_url ?? input.config.openai_base_url
  const wireApi = activeProvider?.wire_api
  const apiMode = wireApi === 'chat'
    ? 'chat-completions'
    : wireApi === 'responses'
      ? 'responses'
      : undefined
  const apiKey = input.auth.OPENAI_API_KEY ?? input.auth.apiKey ?? input.auth.api_key
  const hasSignal = input.configFound
    || input.authFound
    || Boolean(input.config.model)
    || Boolean(baseUrl)
    || Boolean(apiKey)

  if (!hasSignal) {
    return null
  }

  return {
    externalId: 'codex:local-current',
    app: 'codex',
    name: 'Local Codex',
    providerKind: 'openai-compatible',
    config: compactRecord({
      baseUrl,
      model: input.config.model,
      apiMode,
      reasoningEffort: maybeEnum(ReasoningEffortSchema, input.config.model_reasoning_effort),
      approvalPolicy: maybeEnum(ApprovalPolicySchema, input.config.approval_policy),
      sandboxMode: maybeEnum(SandboxModeSchema, input.config.sandbox_mode)
    }),
    credential: apiKey ? { kind: 'api-key', value: apiKey, label: 'Local Codex' } : undefined,
    current: true,
    metadata: compactRecord({
      baseUrl,
      model: input.config.model,
      apiFormat: wireApi ? `openai_${wireApi}` : 'openai',
      rawFingerprintHint: hashText({
        configFound: input.configFound,
        authFound: input.authFound,
        modelProvider: providerId,
        baseUrl,
        wireApi,
        model: input.config.model,
        reasoningEffort: input.config.model_reasoning_effort,
        approvalPolicy: input.config.approval_policy,
        sandboxMode: input.config.sandbox_mode,
        hasCredential: Boolean(apiKey)
      })
    }),
    warnings: apiKey
      ? []
      : [{
          code: 'local-codex-credential-missing',
          message: 'No Codex API key was found in the allowlisted local config or process environment.',
          severity: 'info'
        }]
  }
}

export function readLocalAgentConfigExternalProviderSnapshot(
  config: LocalAgentConfigSourceConfig
): ExternalProviderSourceSnapshot {
  const claude = readClaudeConfig(config)
  const codex = readCodexConfig(config)
  const providers = [claudeRecord(claude), codexRecord(codex)]
    .filter((record): record is ExternalProviderRecord => Boolean(record))
  const warnings = [...claude.warnings, ...codex.warnings]

  return {
    source: {
      status: warnings.some((warning) => warning.severity === 'error')
        ? 'error'
        : warnings.length > 0
          ? 'warning'
          : 'ok',
      message: providers.length > 0
        ? `Detected ${providers.length} local agent config ${providers.length === 1 ? 'record' : 'records'}.`
        : 'No local Claude or Codex config records were detected.',
      observedAt: new Date().toISOString()
    },
    providers,
    inventory: {},
    warnings
  }
}

export async function readLocalAgentConfigExternalProviderSnapshotFromContext(
  ctx: ExternalProviderSourceReadContext
): Promise<ExternalProviderSourceSnapshot> {
  return readLocalAgentConfigExternalProviderSnapshot(resolveLocalAgentConfigSourceConfig(ctx))
}

export function createLocalAgentConfigExternalProviderSource(): ExternalProviderSource {
  return {
    id: DEFAULT_SOURCE_ID,
    label: DEFAULT_SOURCE_LABEL,
    description: 'Reads local Claude and Codex configuration for onboarding.',
    capabilities: { refresh: true },
    readSnapshot: readLocalAgentConfigExternalProviderSnapshotFromContext
  }
}
