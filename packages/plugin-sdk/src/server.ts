import type { Disposable, Logger, PluginManifest } from './index'

// Re-export shared types for convenience
export type { Disposable, Logger, PluginManifest } from './index'

/** Server plugin context — provided by host during activation */
export interface ServerPluginContext {
  /** Scoped Elysia app — register routes via standard Elysia API */
  app: unknown // Elysia type — plugin imports elysia themselves if needed

  /** Register an MCP server for agent runtime */
  registerMcpServer(config: McpServerConfig): void

  /** Register a skill for agent discovery */
  registerSkill(skill: SkillDefinition): void

  /** Register external provider sources that return host-rendered provider snapshots */
  externalProviderSources: ExternalProviderSourceRegistry

  /** Plugin-scoped persistent KV storage */
  storage: PluginStorage

  /** Plugin-scoped logger */
  logger: Logger

  /** Shared config from desktop plugin (passed via env vars) */
  sharedConfig: ReadonlyMap<string, string>

  /** Plugin manifest metadata */
  manifest: PluginManifest

  /** Chat lifecycle hooks */
  hooks: ServerPluginHooks

  /** Event bus — subscribe to host-emitted events */
  events: PluginEventBus
}

export interface McpServerConfig {
  /** Unique name for this MCP server */
  name: string
  /** Command to execute (e.g. 'node') */
  command: string
  /** Arguments for the command */
  args: string[]
  /** Environment variables for the process */
  env?: Record<string, string>
  /** Predicate — if returns false, server is not registered */
  when?: () => boolean | Promise<boolean>
}

export interface SkillDefinition {
  /** Skill name (used as identifier) */
  name: string
  /** Human-readable description */
  description: string
  /** Absolute path to SKILL.md file */
  skillFile: string
}

export interface ExternalProviderSourceRegistry {
  register(source: ExternalProviderSource): Disposable
}

export interface ExternalProviderSource {
  id: string
  label: string
  description?: string
  capabilities?: ExternalProviderSourceCapabilities
  readSnapshot(ctx: ExternalProviderSourceReadContext): Promise<ExternalProviderSourceSnapshot>
}

export interface ExternalProviderSourceCapabilities {
  refresh?: boolean
  revealSourceFile?: boolean
  importAsNative?: boolean
}

export interface ExternalProviderSourceReadContext {
  signal: AbortSignal
  logger: Logger
  sharedConfig: ReadonlyMap<string, string>
}

export interface ExternalProviderSourceSnapshot {
  source: ExternalProviderSourceSnapshotInfo
  providers: ExternalProviderRecord[]
  inventory?: ExternalProviderInventory
  warnings?: ExternalProviderWarning[]
}

export interface ExternalProviderSourceSnapshotInfo {
  status: 'ok' | 'warning' | 'error'
  message?: string
  observedAt?: string
}

export interface ExternalProviderRecord {
  externalId: string
  app: string
  name: string
  providerKind: 'anthropic' | 'openai-compatible'
  config: Record<string, unknown>
  credential?: ExternalProviderCredential
  current?: boolean
  enabled?: boolean
  readonly?: boolean
  metadata?: ExternalProviderRecordMetadata
  warnings?: ExternalProviderWarning[]
}

export interface ExternalProviderCredential {
  kind: 'api-key'
  value: string
  label?: string
}

export interface ExternalProviderRecordMetadata {
  baseUrl?: string
  model?: string
  apiFormat?: string
  health?: 'healthy' | 'unhealthy' | 'unknown'
  sourceUpdatedAt?: string
  rawFingerprintHint?: string
}

export interface ExternalProviderInventory {
  mcpServers?: number
  prompts?: number
  skills?: number
  usageRollups?: number
  modelPricingEntries?: number
}

export interface ExternalProviderWarning {
  code: string
  message: string
  severity: 'info' | 'warning' | 'error'
}

export interface PluginStorage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

/** Chat lifecycle hooks — intercept/observe agent queries */
export interface ServerPluginHooks {
  /** Called before an agent query is executed. Can modify the query context. */
  onBeforeQuery(handler: BeforeQueryHandler): Disposable
  /** Called after an agent response is received (observation only). */
  onAfterResponse(handler: AfterResponseHandler): Disposable
}

export type BeforeQueryHandler = (ctx: QueryHookContext) => QueryHookContext | Promise<QueryHookContext>

export interface QueryHookContext {
  /** Messages to send to the agent */
  messages: Array<{ role: string; content: string }>
  /** Model being used */
  model: string
  /** Thread ID */
  threadId: string
  /** Additional metadata plugins can attach */
  metadata: Record<string, unknown>
}

export type AfterResponseHandler = (ctx: ResponseHookContext) => void | Promise<void>

export interface ResponseHookContext {
  /** Thread ID */
  threadId: string
  /** Model used */
  model: string
  /** Usage stats if available */
  usage?: { inputTokens: number; outputTokens: number }
  /** Duration in ms */
  durationMs: number
}

/** Event bus for plugin-to-host communication */
export interface PluginEventBus {
  /** Subscribe to a host event */
  on(event: string, handler: (data: unknown) => void): Disposable
  /** Emit an event (other plugins and host can listen) */
  emit(event: string, data: unknown): void
}

/** Server plugin module shape */
export interface ServerPlugin {
  activate(ctx: ServerPluginContext): void | Promise<void>
  deactivate?(): void | Promise<void>
}
