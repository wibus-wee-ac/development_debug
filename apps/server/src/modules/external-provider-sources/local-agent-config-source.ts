// Output: Local agent config reader for onboarding external provider snapshots.
// Input: Allowlisted local config files, optional process environment values, and PATH-based CLI tool detection.
// Position: External provider source utilities owned by Cradle onboarding/provider integration.

import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type {
  ExternalProviderRecord,
  ExternalProviderSource,
  ExternalProviderSourceReadContext,
  ExternalProviderSourceSnapshot,
  ExternalProviderWarning,
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
  ANTHROPIC_DEFAULT_OPUS_MODEL: OptionalStringSchema,
}).catchall(z.unknown())

const ClaudeSettingsSchema = z.object({
  env: ClaudeEnvSchema.optional().default({}),
}).passthrough()

const CodexAuthSchema = z.object({
  OPENAI_API_KEY: OptionalStringSchema,
  apiKey: OptionalStringSchema,
  api_key: OptionalStringSchema,
}).catchall(z.unknown())

const CodexModelProviderSchema = z.object({
  base_url: OptionalStringSchema,
  wire_api: OptionalStringSchema,
}).passthrough()

const CodexTomlSchema = z.object({
  model_provider: OptionalStringSchema,
  model: OptionalStringSchema,
  model_reasoning_effort: OptionalStringSchema,
  approval_policy: OptionalStringSchema,
  sandbox_mode: OptionalStringSchema,
  openai_base_url: OptionalStringSchema,
  model_providers: z.record(z.string(), CodexModelProviderSchema).default({}),
}).passthrough()

const GeminiSettingsSchema = z.object({
  apiKey: OptionalStringSchema,
  model: OptionalStringSchema,
  theme: OptionalStringSchema,
}).catchall(z.unknown())

const PiSettingsSchema = z.object({
  apiKey: OptionalStringSchema,
  model: OptionalStringSchema,
  endpoint: OptionalStringSchema,
}).catchall(z.unknown())

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
    includeProcessEnv: sourceConfigFlag(ctx, 'LOCAL_AGENT_CONFIG_INCLUDE_PROCESS_ENV', true),
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
        .transform(raw => JSON.parse(raw))
        .pipe(schema)
        .parse(readFileSync(path, 'utf8')),
      warning: null,
    }
  }
 catch (error) {
    return {
      found: true,
      value: null,
      warning: {
        code: warningCode,
        message: `${label} could not be parsed. ${errorMessage(error)}`,
        severity: 'warning',
      },
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
      warning: null,
    }
  }
 catch (error) {
    return {
      found: true,
      value: null,
      warning: {
        code: warningCode,
        message: `${label} could not be parsed. ${errorMessage(error)}`,
        severity: 'warning',
      },
    }
  }
}

function readClaudeConfig(config: LocalAgentConfigSourceConfig): ClaudeConfigReadResult {
  const settings = readJsonFile(config.claudeSettingsPath, ClaudeSettingsSchema, 'local-claude-settings-invalid', 'Claude settings')
  const localSettings = readJsonFile(
    config.claudeLocalSettingsPath,
    ClaudeSettingsSchema,
    'local-claude-local-settings-invalid',
    'Claude local settings',
  )

  const processEnv = config.includeProcessEnv
    ? ClaudeEnvSchema.parse(process.env)
    : {}
  const env = ClaudeEnvSchema.parse({
    ...settings.value?.env,
    ...localSettings.value?.env,
    ...processEnv,
  })
  const warnings = [settings.warning, localSettings.warning].filter((warning): warning is ExternalProviderWarning => Boolean(warning))

  return {
    settingsPath: config.claudeSettingsPath,
    localSettingsPath: config.claudeLocalSettingsPath,
    settingsFound: settings.found,
    localSettingsFound: localSettings.found,
    env,
    warnings,
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
      ...processAuth,
    }),
    warnings,
  }
}

// --- PATH-based CLI tool detection ---

interface CliToolConfig {
  command: string
  settingsDir: string
  settingsFile: string
  envKeyVars: string[]
  envBaseUrlVars: string[]
  envModelVars: string[]
}

interface DetectedCliTool {
  tool: CliToolConfig
  executablePath: string
  settings: JsonObject | null
  settingsFound: boolean
  warnings: ExternalProviderWarning[]
}

const CLI_TOOLS: CliToolConfig[] = [
  {
    command: 'gemini',
    settingsDir: join(homedir(), '.gemini'),
    settingsFile: join(homedir(), '.gemini', 'settings.json'),
    envKeyVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    envBaseUrlVars: ['GEMINI_BASE_URL', 'GOOGLE_BASE_URL'],
    envModelVars: ['GEMINI_MODEL'],
  },
  {
    command: 'pi',
    settingsDir: join(homedir(), '.pi'),
    settingsFile: join(homedir(), '.pi', 'config.json'),
    envKeyVars: ['PI_API_KEY'],
    envBaseUrlVars: ['PI_BASE_URL'],
    envModelVars: ['PI_MODEL'],
  },
]

function detectCliExecutable(command: string): string | null {
  try {
    return execSync(`which ${command}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() || null
  }
 catch {
    return null
  }
}

function detectCliTools(): DetectedCliTool[] {
  const results: DetectedCliTool[] = []
  for (const tool of CLI_TOOLS) {
    const executablePath = detectCliExecutable(tool.command)
    if (!executablePath) {
      continue
    }

    const settingsResult = readJsonFile(tool.settingsFile, GeminiSettingsSchema, `local-${tool.command}-settings-invalid`, `${tool.command} settings`)
    const settings = settingsResult.found ? (settingsResult.value as JsonObject ?? {}) : {}
    const warnings = settingsResult.warning ? [settingsResult.warning] : []

    results.push({
      tool,
      executablePath,
      settings: settingsResult.found ? settings : null,
      settingsFound: settingsResult.found,
      warnings,
    })
  }
  return results
}

function cliToolRecord(detected: DetectedCliTool): ExternalProviderRecord | null {
  const envApiKey = detected.tool.envKeyVars
    .map(key => process.env[key])
    .find(val => val && val.trim().length > 0)

  const settingsApiKey = detected.settings
    ? (detected.settings.apiKey as string | undefined)
    : undefined
  const apiKey = settingsApiKey ?? envApiKey

  const envBaseUrl = detected.tool.envBaseUrlVars
    .map(key => process.env[key])
    .find(val => val && val.trim().length > 0)

  const settingsModel = detected.settings
    ? (detected.settings.model as string | undefined)
    : undefined
  const envModel = detected.tool.envModelVars
    .map(key => process.env[key])
    .find(val => val && val.trim().length > 0)
  const model = settingsModel ?? envModel

  const settingsEndpoint = detected.settings
    ? (detected.settings.endpoint as string | undefined)
    : undefined
  const baseUrl = settingsEndpoint ?? envBaseUrl

  const hasSignal = detected.settingsFound || Boolean(apiKey) || Boolean(baseUrl) || Boolean(model)
  if (!hasSignal) {
    return null
  }

  const app = detected.tool.command as 'gemini' | 'pi'

  return {
    externalId: `${detected.tool.command}:local-current`,
    app,
    name: `Local ${detected.tool.command.charAt(0).toUpperCase()}${detected.tool.command.slice(1)}`,
    providerKind: 'cli-tool',
    config: compactRecord({
      executable: detected.executablePath,
      baseUrl,
      model,
    }),
    credential: apiKey ? { kind: 'api-key', value: apiKey, label: `Local ${detected.tool.command}` } : undefined,
    current: true,
    metadata: compactRecord({
      executable: detected.executablePath,
      baseUrl,
      model,
      apiFormat: 'cli-tool',
      rawFingerprintHint: hashText({
        executable: detected.executablePath,
        settingsFound: detected.settingsFound,
        baseUrl,
        model,
        hasCredential: Boolean(apiKey),
      }),
    }),
    warnings: apiKey
      ? []
      : [{
          code: `local-${detected.tool.command}-credential-missing`,
          message: `No ${detected.tool.command} API key was found in local config or environment.`,
          severity: 'info' as const,
        }],
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
    opus: input.env.ANTHROPIC_DEFAULT_OPUS_MODEL,
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
      claudeAgent: hasAlias ? { modelAliases } : undefined,
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
        hasCredential: Boolean(apiKey),
      }),
    }),
    warnings: apiKey
      ? []
      : [{
          code: 'local-claude-credential-missing',
          message: 'No Claude API key was found in the allowlisted local config or process environment.',
          severity: 'info',
        }],
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
      sandboxMode: maybeEnum(SandboxModeSchema, input.config.sandbox_mode),
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
        hasCredential: Boolean(apiKey),
      }),
    }),
    warnings: apiKey
      ? []
      : [{
          code: 'local-codex-credential-missing',
          message: 'No Codex API key was found in the allowlisted local config or process environment.',
          severity: 'info',
        }],
  }
}

export function readLocalAgentConfigExternalProviderSnapshot(
  config: LocalAgentConfigSourceConfig,
): ExternalProviderSourceSnapshot {
  const claude = readClaudeConfig(config)
  const codex = readCodexConfig(config)
  const cliTools = detectCliTools()
  const cliRecords = cliTools
    .map(detected => cliToolRecord(detected))
    .filter((record): record is ExternalProviderRecord => Boolean(record))

  const providers = [claudeRecord(claude), codexRecord(codex), ...cliRecords]
    .filter((record): record is ExternalProviderRecord => Boolean(record))
  const warnings = [
    ...claude.warnings,
    ...codex.warnings,
    ...cliTools.flatMap(t => t.warnings),
  ]

  return {
    source: {
      status: warnings.some(warning => warning.severity === 'error')
        ? 'error'
        : warnings.length > 0
          ? 'warning'
          : 'ok',
      message: providers.length > 0
        ? `Detected ${providers.length} local agent config ${providers.length === 1 ? 'record' : 'records'}.`
        : 'No local agent config records were detected.',
      observedAt: new Date().toISOString(),
    },
    providers,
    inventory: {},
    warnings,
  }
}

export async function readLocalAgentConfigExternalProviderSnapshotFromContext(
  ctx: ExternalProviderSourceReadContext,
): Promise<ExternalProviderSourceSnapshot> {
  return readLocalAgentConfigExternalProviderSnapshot(resolveLocalAgentConfigSourceConfig(ctx))
}

export function createLocalAgentConfigExternalProviderSource(): ExternalProviderSource {
  return {
    id: DEFAULT_SOURCE_ID,
    label: DEFAULT_SOURCE_LABEL,
    description: 'Reads local agent configuration and detects CLI tools on PATH for onboarding.',
    capabilities: { refresh: true },
    readSnapshot: readLocalAgentConfigExternalProviderSnapshotFromContext,
  }
}
