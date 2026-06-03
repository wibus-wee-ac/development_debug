import type { CodexConfig } from '../../provider-contracts/provider-base'
import { readTrustedCodexConfig, resolveApiKey } from '../../provider-contracts/provider-base'
import type { RuntimeProviderTargetProfile, RuntimeSession } from '../../chat-runtime/runtime-provider-types'
import { getRegisteredMcpServers } from '../../../plugins'
import type { CodexAppServerClientOptions, CodexAppServerMessage, CodexAppServerServerRequest } from './app-server-client'
import { buildCradleCodexAppServerEnv, CodexAppServerClient } from './app-server-client'
import {
  CODEX_APP_SERVER_CAPABILITIES,
  CODEX_APP_SERVER_CLIENT_METHOD_SET,
  readCodexAppServerMethodCapability,
  type CodexAppServerMethodCapability,
} from './app-server-capabilities'
import type { CodexAppServerCapabilityManifest } from './app-server-capabilities'
import { resolveCodexRuntimeContext } from './runtime-context'
import { buildCodexServerRequestToolInput, buildCodexServerRequestToolOutput } from './tools/mapper'

export type { CodexAppServerCapabilityManifest } from './app-server-capabilities'

const CRADLE_CODEX_MODEL_PROVIDER = 'cradle-openai-compatible'
const CRADLE_CODEX_API_KEY_ENV = 'CRADLE_CODEX_API_KEY'

interface CodexAppServerBridgeDeps {
  readSecret: (credentialRef: string) => string
  resolveSkillPaths: (workspacePath: string) => string[]
  createAppServerClient?: (options: CodexAppServerClientOptions) => CodexAppServerClientLike
}

interface CodexAppServerClientLike {
  initialize: () => Promise<void>
  request: (method: string, params?: unknown) => Promise<unknown>
  nextNotification: (signal?: AbortSignal) => Promise<CodexAppServerMessage | null>
  close: () => void
}

export interface CodexAppServerBridgeContext {
  runtimeSession: RuntimeSession
  profile: RuntimeProviderTargetProfile
  workspacePath: string
  workspaceId?: string | null
  agentId?: string | null
  modelId?: string
}

export interface CodexAppServerInvokeInput extends CodexAppServerBridgeContext {
  method: string
  params?: unknown
}

export interface CodexAppServerInvokeResponse {
  method: string
  capability: CodexAppServerMethodCapability
  result: unknown
}

export interface CodexAppServerStreamInput extends CodexAppServerInvokeInput {
  closeOnMethods?: string[]
}

export function getCodexAppServerCapabilities(): CodexAppServerCapabilityManifest {
  return CODEX_APP_SERVER_CAPABILITIES
}

export class CodexAppServerBridge {
  constructor(private readonly deps: CodexAppServerBridgeDeps) {}

  async invoke(input: CodexAppServerInvokeInput): Promise<CodexAppServerInvokeResponse> {
    const capability = requireCodexAppServerMethod(input.method)
    const client = this.createClient(input, {
      serverRequestHandler: request => buildDefaultCodexAppServerRequestResult(request),
    })
    try {
      await client.initialize()
      const result = await client.request(input.method, normalizeParams(capability, input.params))
      return { method: input.method, capability, result }
    }
    finally {
      client.close()
    }
  }

  openEventStream(input: CodexAppServerStreamInput): ReadableStream<Uint8Array> {
    const capability = requireCodexAppServerMethod(input.method)
    const encoder = new TextEncoder()
    const abortController = new AbortController()
    const closeOnMethods = new Set(input.closeOnMethods ?? defaultCloseMethodsFor(input.method))
    const shouldWaitForNotifications = shouldKeepStreamOpenAfterResult(
      input.method,
      capability,
      closeOnMethods,
      input.closeOnMethods !== undefined,
    )
    let client: CodexAppServerClientLike | null = null

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        client = this.createClient(input, {
          serverRequestHandler: async request => {
            const result = buildDefaultCodexAppServerRequestResult(request)
            writeSse(controller, encoder, 'server_request', {
              method: request.method,
              id: request.id,
              params: request.params,
              input: buildCodexServerRequestToolInput(request),
              output: buildCodexServerRequestToolOutput(request, result),
            })
            return result
          },
        })

        void (async () => {
          try {
            await client!.initialize()
            const resultPromise = client!.request(input.method, normalizeParams(capability, input.params))
            writeSse(controller, encoder, 'request_started', { method: input.method, capability })

            const notificationPump = pumpNotifications({
              client: client!,
              signal: abortController.signal,
              write: message => {
                writeSse(controller, encoder, 'notification', message)
                return Boolean(message.method && closeOnMethods.has(message.method))
              },
            })

            const result = await resultPromise
            writeSse(controller, encoder, 'result', { method: input.method, result })
            if (shouldWaitForNotifications) {
              await notificationPump.catch(() => undefined)
            }
            else {
              abortController.abort()
              await notificationPump.catch(() => undefined)
            }
            writeDone(controller, encoder)
          }
          catch (error) {
            writeSse(controller, encoder, 'error', {
              message: error instanceof Error ? error.message : String(error),
            })
            writeDone(controller, encoder)
          }
          finally {
            client?.close()
          }
        })()
      },
      cancel: () => {
        abortController.abort()
        client?.close()
      },
    })
  }

  private createClient(
    context: CodexAppServerBridgeContext,
    options: Pick<CodexAppServerClientOptions, 'serverRequestHandler'> = {},
  ): CodexAppServerClientLike {
    const config = readTrustedCodexConfig(context.profile.configJson)
    const apiKey = resolveApiKey(context.profile, config.apiKey, 'OPENAI_API_KEY', this.deps)
    if (!apiKey) {
      throw new Error('Codex app-server bridge requires an API key')
    }
    const runtimeContext = resolveCodexRuntimeContext(context.workspacePath, context.agentId)
    return this.deps.createAppServerClient?.({
      apiKey,
      config: buildBridgeCodexConfig(config, context.workspacePath, this.deps.resolveSkillPaths, context.modelId),
      env: buildCradleCodexAppServerEnv({
        chatSessionId: context.runtimeSession.chatSessionId,
        workspaceId: context.workspaceId,
        workspacePath: context.workspacePath,
        agentId: context.agentId,
        agentHome: runtimeContext.agentHome,
      }),
      serverRequestHandler: options.serverRequestHandler,
    }) ?? new CodexAppServerClient({
      apiKey,
      config: buildBridgeCodexConfig(config, context.workspacePath, this.deps.resolveSkillPaths, context.modelId),
      env: buildCradleCodexAppServerEnv({
        chatSessionId: context.runtimeSession.chatSessionId,
        workspaceId: context.workspaceId,
        workspacePath: context.workspacePath,
        agentId: context.agentId,
        agentHome: runtimeContext.agentHome,
      }),
      serverRequestHandler: options.serverRequestHandler,
    })
  }
}

function requireCodexAppServerMethod(method: string): CodexAppServerMethodCapability {
  if (!CODEX_APP_SERVER_CLIENT_METHOD_SET.has(method)) {
    throw new Error(`Unsupported Codex app-server method: ${method}`)
  }
  return readCodexAppServerMethodCapability(method)!
}

function normalizeParams(capability: CodexAppServerMethodCapability, params: unknown): unknown {
  return capability.paramsType === null ? undefined : params ?? {}
}

function buildBridgeCodexConfig(
  config: CodexConfig,
  workspacePath: string,
  resolveSkillPaths: (workspacePath: string) => string[],
  effectiveModel?: string | null,
): Record<string, unknown> {
  const skillPaths = config.skillPaths.length > 0
    ? config.skillPaths
    : resolveSkillPaths(workspacePath)
  const mcpServers = buildCodexMcpServersConfig()
  return {
    approval_policy: config.approvalPolicy,
    sandbox_mode: config.sandboxMode,
    network_access: "enabled",
    show_raw_agent_reasoning: true,
    disable_response_storage: true,
    ...(skillPaths.length > 0 ? { instructions_paths: skillPaths } : {}),
    ...(Object.keys(mcpServers).length > 0 ? { mcp_servers: mcpServers } : {}),
    ...(config.baseUrl
      ? {
          model_provider: CRADLE_CODEX_MODEL_PROVIDER,
          model_providers: {
            [CRADLE_CODEX_MODEL_PROVIDER]: {
              name: 'Cradle OpenAI Compatible',
              base_url: config.baseUrl,
              env_key: CRADLE_CODEX_API_KEY_ENV,
              wire_api: 'responses',
              requires_openai_auth: true,
            },
          },
        }
      : {}),
    ...(effectiveModel ?? config.model ? { model: effectiveModel ?? config.model } : {}),
  }
}

function buildCodexMcpServersConfig(): Record<string, { command: string, args: string[], env?: Record<string, string> }> {
  return Object.fromEntries(
    Object.entries(getRegisteredMcpServers()).map(([name, config]) => {
      const server: { command: string, args: string[], env?: Record<string, string> } = {
        command: config.command,
        args: config.args,
      }
      if (config.env && Object.keys(config.env).length > 0) {
        server.env = config.env
      }
      return [name, server]
    }),
  )
}

async function pumpNotifications(input: {
  client: CodexAppServerClientLike
  signal: AbortSignal
  write: (message: CodexAppServerMessage) => boolean
}): Promise<void> {
  while (!input.signal.aborted) {
    let message: CodexAppServerMessage | null
    try {
      message = await input.client.nextNotification(input.signal)
    }
    catch (error) {
      if (input.signal.aborted) {
        return
      }
      throw error
    }
    if (!message) {
      return
    }
    if (input.write(message)) {
      return
    }
  }
}

function defaultCloseMethodsFor(method: string): string[] {
  if (method === 'turn/start') {
    return ['turn/completed']
  }
  if (method === 'process/spawn') {
    return ['process/exited']
  }
  if (method === 'thread/realtime/start') {
    return ['thread/realtime/closed', 'thread/realtime/error']
  }
  if (method.startsWith('fuzzyFileSearch/session')) {
    return ['fuzzyFileSearch/sessionCompleted']
  }
  if (method === 'account/login/start') {
    return ['account/login/completed']
  }
  if (method === 'windowsSandbox/setupStart') {
    return ['windowsSandbox/setupCompleted']
  }
  if (method === 'externalAgentConfig/import') {
    return ['externalAgentConfig/import/completed']
  }
  return []
}

function shouldKeepStreamOpenAfterResult(
  method: string,
  capability: CodexAppServerMethodCapability,
  closeOnMethods: Set<string>,
  hasExplicitClosePolicy: boolean,
): boolean {
  if (capability.interaction !== 'stream') {
    return false
  }
  if (closeOnMethods.size > 0) {
    return true
  }
  if (hasExplicitClosePolicy) {
    return false
  }
  return method === 'fs/watch'
}

function writeSse(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  data: unknown,
): void {
  controller.enqueue(encoder.encode(`event: ${event}\n`))
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
}

function writeDone(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder): void {
  controller.enqueue(encoder.encode('event: done\n'))
  controller.enqueue(encoder.encode('data: {}\n\n'))
  controller.close()
}

export function buildDefaultCodexAppServerRequestResult(request: CodexAppServerServerRequest): unknown {
  switch (request.method) {
    case 'item/commandExecution/requestApproval':
      return { decision: 'decline' }
    case 'item/fileChange/requestApproval':
      return { decision: 'decline' }
    case 'item/tool/requestUserInput':
      return { answers: {} }
    case 'mcpServer/elicitation/request':
      return { action: 'decline', content: null, _meta: null }
    case 'item/permissions/requestApproval':
      return { permissions: {}, scope: 'turn' }
    case 'item/tool/call':
      return { contentItems: [{ type: 'text', text: 'Cradle Codex app-server bridge does not execute external dynamic tools.' }], success: false }
    case 'account/chatgptAuthTokens/refresh':
      throw new Error('Cradle Codex app-server bridge cannot refresh ChatGPT auth tokens')
    case 'attestation/generate':
      throw new Error('Cradle Codex app-server bridge cannot generate client attestation tokens')
    case 'applyPatchApproval':
      return { decision: 'denied' }
    case 'execCommandApproval':
      return { decision: 'denied' }
    default:
      throw new Error(`Unhandled Codex app-server request: ${request.method}`)
  }
}
