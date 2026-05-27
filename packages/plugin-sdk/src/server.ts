import type { Disposable, Logger, PluginManifest } from './index'

// Re-export shared types for convenience
export type { Disposable, Logger, PluginManifest } from './index'

/** Server plugin context — provided by host during activation */
export interface ServerPluginContext {
  /** HTTP route registrations owned by this plugin. */
  routes: ServerPluginRouteRegistry

  /** MCP server registrations */
  mcp: ServerPluginMcpRegistry

  /** Skill registrations */
  skills: ServerPluginSkillRegistry

  /** Provider-related registrations */
  providers: ServerPluginProviderRegistries

  /** Disposables that the host releases when this plugin layer deactivates */
  subscriptions: Disposable[]

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

export type ServerPluginRouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface ServerPluginRouteContext<
  TBody = unknown,
  TParams extends Record<string, string> = Record<string, string>,
  TQuery extends Record<string, unknown> = Record<string, unknown>,
> {
  body: TBody
  params: TParams
  query: TQuery
  headers: Record<string, string | undefined>
  set: {
    status?: number | string
    headers?: Record<string, string>
  }
}

export type ServerPluginRouteHandler<
  TBody = unknown,
  TParams extends Record<string, string> = Record<string, string>,
  TQuery extends Record<string, unknown> = Record<string, unknown>,
> = (context: ServerPluginRouteContext<TBody, TParams, TQuery>) => unknown | Promise<unknown>

export interface ServerPluginRouteRegistration<
  TBody = unknown,
  TParams extends Record<string, string> = Record<string, string>,
  TQuery extends Record<string, unknown> = Record<string, unknown>,
> {
  method: ServerPluginRouteMethod
  /** Path below /api/plugins/{routeSegment}; must start with '/'. */
  path: string
  handler: ServerPluginRouteHandler<TBody, TParams, TQuery>
  label?: string
  metadata?: Record<string, unknown>
}

export interface ServerPluginRouteRegistry {
  /** Register a plugin-owned HTTP route below /api/plugins/{routeSegment}. */
  register: (route: ServerPluginRouteRegistration) => Disposable
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

export interface ServerPluginMcpRegistry {
  /** Register an MCP server for agent runtime */
  registerServer: (config: McpServerConfig) => Disposable | Promise<Disposable | undefined> | undefined
}

export interface SkillDefinition {
  /** Skill name (used as identifier) */
  name: string
  /** Human-readable description */
  description: string
  /** Absolute path to SKILL.md file */
  skillFile: string
}

export interface ServerPluginSkillRegistry {
  /** Register a skill for agent discovery */
  register: (skill: SkillDefinition) => Disposable
}

export interface ServerPluginProviderRegistries {
  /** External provider sources that return host-rendered provider snapshots */
  externalSources: ExternalProviderSourceRegistry
}

export interface ExternalProviderSourceRegistry {
  register: (source: ExternalProviderSource) => Disposable
}

export interface ExternalProviderSource {
  id: string
  label: string
  description?: string
  capabilities?: ExternalProviderSourceCapabilities
  readSnapshot: (ctx: ExternalProviderSourceReadContext) => Promise<ExternalProviderSourceSnapshot>
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
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string) => Promise<void>
  delete: (key: string) => Promise<void>
}

/** Chat lifecycle hooks — intercept/observe agent queries */
export interface ServerPluginHooks {
  /** Chat lifecycle hooks grouped under a domain namespace */
  chat: ServerPluginChatHooks
}

export interface ServerPluginChatHooks {
  /** Called before an agent query is executed. Can modify the query context. */
  onBeforeQuery: (handler: BeforeQueryHandler) => Disposable
  /** Called after an agent response is received (observation only). */
  onAfterResponse: (handler: AfterResponseHandler) => Disposable
}

export type BeforeQueryHandler = (
  ctx: QueryHookContext,
) => QueryHookContext | Promise<QueryHookContext>

export interface QueryHookContext {
  /** Messages to send to the agent */
  messages: Array<{ role: string, content: string }>
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
  usage?: { inputTokens: number, outputTokens: number }
  /** Duration in ms */
  durationMs: number
}

/** Event bus for plugin-to-host communication */
export interface PluginEventBus {
  /** Subscribe to a host event */
  on: (event: string, handler: (data: unknown) => void) => Disposable
  /** Emit an event (other plugins and host can listen) */
  emit: (event: string, data: unknown) => void
}

/** Server plugin module shape */
export interface ServerPlugin {
  activate: (ctx: ServerPluginContext) => void | Promise<void>
  deactivate?: () => void | Promise<void>
}
