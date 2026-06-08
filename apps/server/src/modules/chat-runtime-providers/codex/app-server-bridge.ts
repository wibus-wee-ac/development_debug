import { getRegisteredMcpServers } from '../../../plugins'
import type { RuntimeProviderTargetProfile, RuntimeSession } from '../../chat-runtime/runtime-provider-types'
import type { CodexConfig } from '../../provider-contracts/provider-base'
import { readTrustedCodexConfig } from '../../provider-contracts/provider-base'
import { providerRuntimeHostManager } from '../../provider-runtime/host-manager'
import type { CodexAppServerCapabilityManifest, CodexAppServerMethodCapability } from './app-server-capabilities'
import { CODEX_APP_SERVER_CAPABILITIES, CODEX_APP_SERVER_CLIENT_METHOD_SET, readCodexAppServerMethodCapability } from './app-server-capabilities'
import type { CodexAppServerClientOptions, CodexAppServerServerRequest } from './app-server-client'
import { buildCradleCodexAppServerEnv, CodexAppServerClient } from './app-server-client'
import { createCodexAppServerHostFingerprint } from './app-server-host-fingerprint'
import {
  addCodexAppServerHostRequestHandler,
  createCodexAppServerHostResource,
  subscribeCodexAppServerHostNotifications,
} from './app-server-host-resource'
import type { CodexChatgptAuthCredential } from './chatgpt-auth'
import {
  buildCodexChatgptAuthLoginParams,
  ensureCodexChatgptAuthAccessToken,
  refreshCodexChatgptAuthCredential,
  resolveCodexAppServerAuth,
} from './chatgpt-auth'
import { resolveCodexRuntimeContext } from './runtime-context'
import { buildCodexServerRequestToolInput, buildCodexServerRequestToolOutput } from './tools/mapper'
import type { CodexAppServerClientLike, CodexAppServerHostResource } from './types'

export type { CodexAppServerCapabilityManifest } from './app-server-capabilities'

const CRADLE_CODEX_MODEL_PROVIDER = 'cradle-openai-compatible'
const CRADLE_CODEX_API_KEY_ENV = 'CRADLE_CODEX_API_KEY'

function resolveBridgeCodexSkillExtraRoots(
  config: CodexConfig,
  workspacePath: string,
  resolveSkillPaths: (workspacePath: string) => string[],
): string[] {
  return config.skillPaths.length > 0
    ? config.skillPaths
    : resolveSkillPaths(workspacePath)
}

async function syncBridgeCodexSkillExtraRoots(client: CodexAppServerClientLike, extraRoots: string[]): Promise<void> {
  if (extraRoots.length === 0) {
    return
  }
  try {
    await client.request('skills/extraRoots/set', { extraRoots })
  }
  catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Codex app-server skills/extraRoots/set failed: ${detail}`)
  }
}

interface CodexAppServerBridgeDeps {
  readSecret: (credentialRef: string) => string
  updateSecretValue?: (credentialRef: string, secret: string) => void
  resolveSkillPaths: (workspacePath: string) => string[]
  createAppServerClient?: (options: CodexAppServerClientOptions) => CodexAppServerClientLike
  readCodexPreferences?: () => { useCradleUserAgent: boolean }
}

interface CodexAppServerBridgeHostLease {
  hostId: string
  resource: CodexAppServerHostResource
  release: () => void
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

type CodexAppServerBridgeRequestHandler = (
  request: CodexAppServerServerRequest,
  chatgptAuth: CodexChatgptAuthCredential | null,
) => Promise<unknown> | unknown

export function getCodexAppServerCapabilities(): CodexAppServerCapabilityManifest {
  return CODEX_APP_SERVER_CAPABILITIES
}

export class CodexAppServerBridge {
  constructor(private readonly deps: CodexAppServerBridgeDeps) {}

  async invoke(input: CodexAppServerInvokeInput): Promise<CodexAppServerInvokeResponse> {
    const capability = requireCodexAppServerMethod(input.method)
    const hostLease = await this.acquireHostLease(input, input.method, {
      serverRequestHandler: (request, auth) => buildDefaultCodexAppServerRequestResult(request, {
        chatgptAuth: auth,
        updateSecretValue: this.deps.updateSecretValue,
      }),
    })
    const client = hostLease.resource.client
    try {
      const result = await client.request(input.method, normalizeParams(capability, input.params))
      return { method: input.method, capability, result }
    }
    finally {
      hostLease.release()
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
    let hostLease: CodexAppServerBridgeHostLease | null = null
    let unsubscribeNotifications: (() => void) | null = null

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        void (async () => {
          try {
            hostLease = await this.acquireHostLease(input, input.method, {
              serverRequestHandler: async (request, auth) => {
                const result = await buildDefaultCodexAppServerRequestResult(request, {
                  chatgptAuth: auth,
                  updateSecretValue: this.deps.updateSecretValue,
                })
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
            if (abortController.signal.aborted) {
              return
            }
            const waitForNotifications = new Promise<void>((resolve) => {
              unsubscribeNotifications = subscribeCodexAppServerHostNotifications(
                hostLease!.resource,
                {
                  onMessage: (message) => {
                    if (abortController.signal.aborted) {
                      resolve()
                      return true
                    }
                    writeSse(controller, encoder, 'notification', message)
                    if (message.method && closeOnMethods.has(message.method)) {
                      resolve()
                      return true
                    }
                    return false
                  },
                  onClose: resolve,
                },
              )
            })
            const resultPromise = hostLease.resource.client.request(input.method, normalizeParams(capability, input.params))
            writeSse(controller, encoder, 'request_started', { method: input.method, capability })

            const abortPromise = new Promise<void>((resolve) => {
              if (abortController.signal.aborted) {
                resolve()
                return
              }
              abortController.signal.addEventListener('abort', () => resolve(), { once: true })
            })
            const notificationWait = shouldWaitForNotifications || closeOnMethods.size > 0
              ? waitForNotifications
              : abortPromise

            const result = await resultPromise
            writeSse(controller, encoder, 'result', { method: input.method, result })
            if (shouldWaitForNotifications) {
              await notificationWait.catch(() => undefined)
            }
            else {
              abortController.abort()
              await abortPromise.catch(() => undefined)
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
            unsubscribeNotifications?.()
            hostLease?.release()
          }
        })()
      },
      cancel: () => {
        abortController.abort()
        unsubscribeNotifications?.()
        hostLease?.release()
      },
    })
  }

  private async acquireHostLease(
    context: CodexAppServerBridgeContext,
    requestedMethod: string,
    options: { serverRequestHandler?: CodexAppServerBridgeRequestHandler } = {},
  ): Promise<CodexAppServerBridgeHostLease> {
    const config = readTrustedCodexConfig(context.profile.configJson)
    const auth = resolveCodexAppServerAuth(context.profile, config.apiKey, 'OPENAI_API_KEY', this.deps)
    if (config.baseUrl && !auth.apiKey) {
      throw new Error('Codex app-server bridge requires an API key for external model providers')
    }
    const runtimeContext = resolveCodexRuntimeContext(context.workspacePath, context.agentId)
    const skillExtraRoots = resolveBridgeCodexSkillExtraRoots(config, context.workspacePath, this.deps.resolveSkillPaths)
    const clientOptions: CodexAppServerClientOptions = this.configureAppServerClientOptions({
      apiKey: auth.apiKey ?? undefined,
      config: buildBridgeCodexConfig(config, context.workspacePath, this.deps.resolveSkillPaths, context.modelId),
      env: buildCradleCodexAppServerEnv({
        chatSessionId: context.runtimeSession.chatSessionId,
        workspaceId: context.workspaceId,
        workspacePath: context.workspacePath,
        agentId: context.agentId,
        agentHome: runtimeContext.agentHome,
      }),
    })
    const hostLease = await providerRuntimeHostManager.acquireResource({
      runtimeKind: context.runtimeSession.runtimeKind,
      providerTargetId: context.profile.providerTargetId,
      scopeId: context.runtimeSession.chatSessionId,
      resourceFingerprint: createCodexAppServerHostFingerprint({
        options: clientOptions,
        chatgptAuth: auth.chatgptAuth,
      }),
      createResource: (): CodexAppServerHostResource => createCodexAppServerHostResource({
        clientOptions,
        createClient: clientOptions => this.deps.createAppServerClient?.(clientOptions) ?? new CodexAppServerClient(clientOptions),
      }),
      disposeResource: resource => resource.client.close(),
    })
    const requestHandler
      = options.serverRequestHandler
      ? request => options.serverRequestHandler!(request, auth.chatgptAuth)
      : undefined
    const releaseRequestHandler = requestHandler
      ? addCodexAppServerHostRequestHandler(hostLease.resource, requestHandler)
      : () => undefined
    const bridgeLease: CodexAppServerBridgeHostLease = {
      hostId: hostLease.hostId,
      resource: hostLease.resource,
      release: () => {
        releaseRequestHandler()
        hostLease.release()
      },
    }
    try {
      await this.initializeClient(bridgeLease.resource, auth.chatgptAuth, requestedMethod)
      await syncBridgeCodexSkillExtraRoots(bridgeLease.resource.client, skillExtraRoots)
      return bridgeLease
    }
    catch (error) {
      providerRuntimeHostManager.invalidateResource(hostLease.hostId)
      bridgeLease.release()
      throw error
    }
  }

  private configureAppServerClientOptions(options: CodexAppServerClientOptions): CodexAppServerClientOptions {
    const userAgentMode = this.deps.readCodexPreferences?.().useCradleUserAgent === false ? 'native' : 'cradle'
    return { ...options, userAgentMode } satisfies CodexAppServerClientOptions
  }

  private async initializeClient(
    resource: CodexAppServerHostResource,
    chatgptAuth: CodexChatgptAuthCredential | null,
    requestedMethod: string,
  ): Promise<void> {
    resource.initialized ??= resource.client.initialize()
    await resource.initialized
    if (!chatgptAuth || isAccountAuthMutationMethod(requestedMethod)) {
      return
    }
    resource.chatgptAuthenticated ??= (async () => {
      const credential = await ensureCodexChatgptAuthAccessToken(chatgptAuth, {
        updateSecretValue: this.deps.updateSecretValue,
      })
      await resource.client.request('account/login/start', buildCodexChatgptAuthLoginParams(credential))
    })()
    await resource.chatgptAuthenticated
  }
}

function isAccountAuthMutationMethod(method: string): boolean {
  return method === 'account/login/start'
    || method === 'account/login/cancel'
    || method === 'account/logout'
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
  _workspacePath: string,
  _resolveSkillPaths: (workspacePath: string) => string[],
  effectiveModel?: string | null,
): Record<string, unknown> {
  const mcpServers = buildCodexMcpServersConfig()
  return {
    approval_policy: config.approvalPolicy,
    sandbox_mode: config.sandboxMode,
    network_access: 'enabled',
    show_raw_agent_reasoning: true,
    disable_response_storage: true,
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

export async function buildDefaultCodexAppServerRequestResult(
  request: CodexAppServerServerRequest,
  options: {
    chatgptAuth?: CodexChatgptAuthCredential | null
    updateSecretValue?: (credentialRef: string, secret: string) => void
  } = {},
): Promise<unknown> {
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
      if (!options.chatgptAuth) {
        throw new Error('Cradle Codex app-server bridge cannot refresh ChatGPT auth tokens without a ChatGPT credential')
      }
      return projectChatgptAuthRefreshResponse(await refreshCodexChatgptAuthCredential(options.chatgptAuth, {
        updateSecretValue: options.updateSecretValue,
      }))
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

function projectChatgptAuthRefreshResponse(credential: CodexChatgptAuthCredential): unknown {
  if (!credential.accessToken) {
    throw new Error('Codex ChatGPT auth refresh did not return an access token')
  }
  return {
    accessToken: credential.accessToken,
    chatgptAccountId: credential.chatgptAccountId,
    chatgptPlanType: credential.chatgptPlanType,
  }
}
