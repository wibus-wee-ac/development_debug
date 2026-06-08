import { randomUUID } from 'node:crypto'
import { unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { LangfuseGeneration } from '@langfuse/tracing'
import { startObservation } from '@langfuse/tracing'
import type { UIMessage, UIMessageChunk } from 'ai'

import { getRegisteredMcpServers } from '../../../plugins'
import { aiTelemetryEnabled } from '../../../telemetry/config'
import { isCodexGoalContinuationMessage } from '../../chat-runtime/message-snapshots'
import type {
  CancelTurnInput,
  ChatRuntime,
  ChatRuntimeAccessMode,
  ChatRuntimeSettings,
  ChatThinkingEffort,
  ExecuteShellCommandInput,
  ExecuteShellCommandResult,
  ForkRuntimeSessionInput,
  GenerateSessionTitleInput,
  GetCapabilitiesInput,
  GetContextUsageInput,
  GetUiSlotStatesInput,
  ProviderContext,
  ProviderNativeAppServerCapabilityManifest,
  ProviderNativeAppServerInvokeInput,
  ProviderNativeAppServerInvokeResponse,
  ProviderNativeAppServerStreamInput,
  ProviderThread,
  ProviderThreadListInput,
  ProviderThreadListResult,
  ProviderThreadReadInput,
  ProviderThreadReadResult,
  ProviderThreadSourceKind,
  ProviderThreadTurn,
  ProviderThreadTurnsInput,
  ProviderThreadTurnsResult,
  QuickQuestionInput,
  ResumeChatSessionInput,
  RuntimeContextUsage,
  RuntimePresentationCapabilities,
  RuntimeSession,
  RuntimeUiSlotState,
  RuntimeUserInputQuestion,
  StartChatSessionInput,
  SteerTurnInput,
  StreamTurnInput,
  UpdateRuntimeSettingsInput,
} from '../../chat-runtime/runtime-provider-types'
import { ProviderErrors, ProviderRuntimeError } from '../../chat-runtime/runtime-provider-types'
import { extractUiMessageText } from '../../chat-runtime/ui-message-input'
import type { TokenUsage } from '../../chat-runtime-engine/ai-sdk-engine'
import { createDedupeKey, OBSERVABILITY_CODES } from '../../observability/contract'
import type { CodexConfig } from '../../provider-contracts/provider-base'
import { readTrustedCodexConfig } from '../../provider-contracts/provider-base'
import type { ProviderRuntimeLease } from '../../provider-runtime/host-manager'
import { providerRuntimeHostManager } from '../../provider-runtime/host-manager'
import { createBoundedTextCollector } from '../bounded-text-collector'
import { readWorkspaceProviderStateSnapshot } from '../provider-state-snapshot'
import {
  buildDefaultCodexAppServerRequestResult,
  CodexAppServerBridge,
  getCodexAppServerCapabilities,
} from './app-server-bridge'
import type { CodexAppServerClientOptions, CodexAppServerMessage } from './app-server-client'
import { buildCradleCodexAppServerEnv, CodexAppServerClient } from './app-server-client'
import { createCodexAppServerHostFingerprint } from './app-server-host-fingerprint'
import {
  addCodexAppServerHostRequestHandler,
  createCodexAppServerHostResource,
} from './app-server-host-resource'
import type { CollaborationMode } from './app-server-protocol/CollaborationMode'
import type { ReasoningEffort } from './app-server-protocol/ReasoningEffort'
import type { SandboxPolicy } from './app-server-protocol/v2/SandboxPolicy'
import type { Thread } from './app-server-protocol/v2/Thread'
import type { ThreadForkParams } from './app-server-protocol/v2/ThreadForkParams'
import type { ThreadInjectItemsParams } from './app-server-protocol/v2/ThreadInjectItemsParams'
import type { ThreadListParams } from './app-server-protocol/v2/ThreadListParams'
import type { ThreadListResponse } from './app-server-protocol/v2/ThreadListResponse'
import type { ThreadReadResponse } from './app-server-protocol/v2/ThreadReadResponse'
import type { ThreadSourceKind } from './app-server-protocol/v2/ThreadSourceKind'
import type { ThreadTurnsListResponse } from './app-server-protocol/v2/ThreadTurnsListResponse'
import type { Turn } from './app-server-protocol/v2/Turn'
import type { UserInput } from './app-server-protocol/v2/UserInput'
import type { CodexAppServerAuthCarrier, CodexAppServerAuthResolution, CodexChatgptAuthCredential } from './chatgpt-auth'
import {
  buildCodexChatgptAuthLoginParams,
  ensureCodexChatgptAuthAccessToken,
  resolveCodexAppServerAuth,
} from './chatgpt-auth'
import { projectCodexEstimatedContextUsage } from './context-usage-projector'
import {
  createCodexAppServerMapperState,
} from './event-to-chunk-mapper'
import {
  describeCodexUserInput,
  isCodexCompactCommand,
  projectCodexUserInput,
  readCodexGoalCommandObjective,
} from './input-projector'
import {
  CODEX_RUNTIME_CAPABILITIES,
  CODEX_RUNTIME_KIND as RUNTIME_KIND,
  CODEX_RUNTIME_METADATA,
  createCodexRuntimePresentation,
} from './metadata'
import { projectCodexNativeTurnsToCodexItems } from './native-history-projector'
import { resolveCodexRuntimeContext } from './runtime-context'
import type { CodexNativeHistorySnapshot } from './state-projector'
import {
  clearCodexGoalSnapshot,
  hasActiveGoal,
  pauseCodexGoalSnapshot,
  projectCodexGoalSnapshotFromGoal,
  projectCodexProviderStateSnapshot,
  readCodexLastTokenUsage,
  readCodexProviderSnapshot,
  readRestorableCodexNativeHistory,
  writeCodexGoalSnapshot,
  writeCodexNativeHistorySnapshot,
  writeCodexThreadSnapshot,
} from './state-projector'
import {
  CodexProviderError,
  createCodexEmptyStreamError,
  createCodexStreamDiagnostics,
  getNotificationTurnId,
  getThreadId,
  getTurnId,
  normalizeProviderTitle,
  readCodexThreadDisplayTitle,
  readLatestThreadTitle,
  readThreadNameUpdate,
  validateCodexStreamOutput,
} from './stream-diagnostics'
import {
  closeCodexMappedTurnChunks,
  continueActiveGoal,
  isCompletedGoalUpdate,
  publishProviderThreadEvent,
  streamCodexMappedTurnEvents,
} from './stream-handler'
import type { CodexAppServerItem } from './tools/mapper'
import { buildCodexToolInput, buildCodexToolOutput, readCodexToolError, readCodexToolName } from './tools/mapper'
import { projectCradleTranscriptToCodexItems } from './transcript-projector'
import type {
  ActiveCodexTurn,
  CodexAppServerClientLike,
  CodexAppServerHostResource,
  CodexAppsListResponse,
  CodexCollaborationModeListResponse,
  CodexConfigReadResponse,
  CodexConfigRequirementsReadResponse,
  CodexGoalSnapshot,
  CodexListMcpServerStatusResponse,
  CodexModelListResponse,
  CodexModelProviderCapabilitiesReadResponse,
  CodexPluginListResponse,
  CodexProviderConfig,
  CodexProviderDeps,
  CodexRateLimitsResponse,
  CodexSkillsListResponse,
  CodexThreadItem,
  CodexThreadStatus,
  CommandExecutionOutputDeltaNotificationParams,
  ItemNotificationParams,
  ThreadGoalGetResponse,
  ThreadResponse,
  ThreadTokenUsageUpdatedNotificationParams,
  TurnResponse,
} from './types'
import { projectCodexUiSlotStates } from './ui-slot-projector'

const CRADLE_CODEX_MODEL_PROVIDER = 'cradle-openai-compatible'
const CRADLE_CODEX_API_KEY_ENV = 'CRADLE_CODEX_API_KEY'
const CODEX_THREAD_TURNS_LIST_LIMIT = 100
const CODEX_SIDE_BOUNDARY_PROMPT = [
  'You are in a Cradle side conversation.',
  '',
  'Cradle owns this side boundary: this child session grows from the parent conversation context, but it is a separate workspace for exploration. Use the inherited context as background, do not treat the side conversation as a continuation that should mutate the parent transcript, and keep any conclusions local until the user explicitly carries them back.',
].join('\n')
const CODEX_SHELL_COMMAND_RESULT_TIMEOUT_MS = 60_000
const CODEX_EPHEMERAL_REQUEST_TIMEOUT_MS = 20_000
const CODEX_THREAD_TITLE_MAX_LENGTH = 36
type CodexTitleGenerationThinkingEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
const CODEX_THREAD_TITLE_PROMPT_PREFIX = [
  'You are naming a Codex task thread.',
  'Generate a concise UI title for the user prompt below.',
  `Keep it at or below ${CODEX_THREAD_TITLE_MAX_LENGTH} characters when possible.`,
  'Use the same language as the user prompt.',
  'Do not answer the prompt.',
  'Do not include quotes, markdown, labels, or trailing punctuation.',
  '',
  'User prompt:',
].join('\n')

function codexRequestError(method: string, detail: string): ProviderRuntimeError {
  return new ProviderRuntimeError(ProviderErrors.requestFailed(RUNTIME_KIND, method, detail))
}

function resolveCodexSkillExtraRoots(
  config: CodexConfig,
  workspacePath: string,
  resolveSkillPaths: (workspacePath: string) => string[],
): string[] {
  return config.skillPaths.length > 0
    ? config.skillPaths
    : resolveSkillPaths(workspacePath)
}

async function syncCodexSkillExtraRoots(client: CodexAppServerClientLike, extraRoots: string[]): Promise<void> {
  if (extraRoots.length === 0) {
    return
  }
  try {
    await client.request('skills/extraRoots/set', { extraRoots })
  }
  catch (error) {
    throw codexRequestError('skills/extraRoots/set', formatUnknownError(error))
  }
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function requestCodexAppServerWithTimeout<T>(
  client: CodexAppServerClientLike,
  method: string,
  params: unknown,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  try {
    return await Promise.race([
      client.request(method, params),
      timeoutPromise,
    ]) as T
  }
  finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

export function createCodexProvider(ctx: ProviderContext, config: CodexProviderConfig = {}): ChatRuntime {
  return new CodexProvider({ ...ctx, ...config })
}

export class CodexProvider implements ChatRuntime {
  readonly runtimeKind = RUNTIME_KIND
  readonly metadata = CODEX_RUNTIME_METADATA
  readonly capabilities = CODEX_RUNTIME_CAPABILITIES

  private readonly activeTurns = new Map<string, ActiveCodexTurn>()
  private _lastUsage: TokenUsage | null = null
  private _lastModelId: string | null = null

  get lastUsage(): TokenUsage | null {
    return this._lastUsage
  }

  get lastModelId(): string | null {
    return this._lastModelId
  }

  constructor(private readonly deps: CodexProviderDeps) {}

  private readonly resolveSkillPaths = (workspacePath: string): string[] => {
    if (!this.deps.resolveSkillPaths) {
      throw codexRequestError('resolveSkillPaths', 'Codex provider requires resolveSkillPaths in ProviderContext')
    }
    return this.deps.resolveSkillPaths(workspacePath)
  }

  private recordObservability(input: Parameters<NonNullable<ProviderContext['recordObservability']>>[0]): void {
    if (!this.deps.recordObservability) {
      return
    }
    this.deps.recordObservability(input)
  }

  private releaseTurn(sessionId: string, entry: ActiveCodexTurn): void {
    if (this.activeTurns.get(sessionId) === entry) {
      this.activeTurns.delete(sessionId)
      entry.hostLease.release()
    }
  }

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    const previousNativeHistory = readRestorableCodexNativeHistory(input.previousProviderStateSnapshot)
    const runtimeContext = resolveCodexRuntimeContext(input.workspacePath, input.agentId)
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: input.profile.providerTargetId,
      runtimeKind: RUNTIME_KIND,
      providerSessionId: null,
      providerStateSnapshot: JSON.stringify({
        workspacePath: input.workspacePath,
        agentId: input.agentId ?? null,
        agentHome: runtimeContext.agentHome,
        models: { currentModelId: input.modelId },
        ...(previousNativeHistory
          ? {
              codex: {
                previousNativeHistory,
              },
            }
          : {}),
      }),
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const agentId = input.agentId ?? snapshot.agentId ?? null
    const runtimeContext = resolveCodexRuntimeContext(input.workspacePath, agentId)
    return {
      ...input.runtimeSession,
      providerStateSnapshot: JSON.stringify({
        ...snapshot,
        workspacePath: input.workspacePath,
        agentId,
        agentHome: runtimeContext.agentHome,
        models: {
          currentModelId: input.modelId ?? snapshot.models.currentModelId,
        },
      }),
    }
  }

  async forkRuntimeSession(input: ForkRuntimeSessionInput): Promise<RuntimeSession> {
    if (!input.sourceRuntimeSession.providerSessionId) {
      throw new ProviderRuntimeError(ProviderErrors.sessionNotFound(this.runtimeKind, input.sourceRuntimeSession.chatSessionId))
    }

    const config = readTrustedCodexConfig(input.profile.configJson)
    const auth = this.resolveAppServerAuth(input.profile, config.apiKey)
    if (config.baseUrl && !auth.apiKey) {
      throw new ProviderRuntimeError(ProviderErrors.authFailed(this.runtimeKind))
    }

    const snapshot = readWorkspaceProviderStateSnapshot(input.sourceRuntimeSession.providerStateSnapshot)
    const workspacePath = snapshot.workspacePath ?? input.workspacePath
    const agentId = input.agentId ?? snapshot.agentId ?? null
    const runtimeContext = resolveCodexRuntimeContext(workspacePath, agentId)
    const effectiveModel = input.modelId ?? snapshot.models.currentModelId ?? config.model
    const skillExtraRoots = resolveCodexSkillExtraRoots(config, workspacePath, this.resolveSkillPaths)
    const codexConfig = buildCodexConfig(config, workspacePath, this.resolveSkillPaths, null, effectiveModel)
    const hostLease = await this.acquireCodexAppServerHost({
      providerTargetId: input.profile.providerTargetId,
      scopeId: input.childChatSessionId,
      chatgptAuth: auth.chatgptAuth,
      pinned: true,
      options: {
        apiKey: auth.apiKey ?? undefined,
        config: codexConfig,
        env: buildCradleCodexAppServerEnv({
          chatSessionId: input.childChatSessionId,
          workspaceId: input.workspaceId,
          workspacePath,
          agentId,
          agentHome: runtimeContext.agentHome,
        }),
        serverRequestHandler: request => buildDefaultCodexAppServerRequestResult(request, {
          chatgptAuth: auth.chatgptAuth,
          updateSecretValue: this.deps.updateSecret,
        }),
      },
    })
    const client = hostLease.resource.client

    try {
      await syncCodexSkillExtraRoots(client, skillExtraRoots)
      const forkParams: ThreadForkParams = {
        threadId: input.sourceRuntimeSession.providerSessionId,
        path: null,
        cwd: runtimeContext.cwd,
        runtimeWorkspaceRoots: runtimeContext.runtimeWorkspaceRoots,
        approvalPolicy: config.approvalPolicy,
        sandbox: config.sandboxMode,
        config: codexConfig,
        model: effectiveModel ?? null,
        ephemeral: true,
        threadSource: 'user',
        excludeTurns: true,
      }
      const response = await client.request('thread/fork', forkParams) as ThreadResponse
      const threadId = response.thread?.id
      if (!threadId) {
        throw codexRequestError('forkRuntimeSession', 'Codex app-server did not return a forked thread id')
      }

      await injectCodexSideBoundary(client, threadId)

      const runtimeSession: RuntimeSession = {
        id: input.childChatSessionId,
        chatSessionId: input.childChatSessionId,
        providerTargetId: input.profile.providerTargetId,
        runtimeKind: RUNTIME_KIND,
        providerSessionId: threadId,
        providerStateSnapshot: JSON.stringify({
          workspacePath,
          agentId,
          agentHome: runtimeContext.agentHome,
          models: { currentModelId: response.model ?? effectiveModel ?? null },
          codex: {
            sideConversation: {
              threadId,
              liveFork: true,
              parentThreadId: input.sourceRuntimeSession.providerSessionId,
              updatedAt: Date.now(),
            },
          },
        }),
      }
      writeCodexThreadSnapshot(runtimeSession, {
        threadId,
        modelId: response.model ?? effectiveModel ?? null,
        modelProvider: response.modelProvider ?? response.thread?.modelProvider ?? null,
        serviceTier: response.serviceTier ?? null,
        reasoningEffort: response.reasoningEffort ?? null,
        status: response.thread?.status ?? null,
      })
      return runtimeSession
    }
    finally {
      hostLease.release()
    }
  }

  async* quickQuestion(input: QuickQuestionInput): AsyncGenerator<UIMessageChunk, void, void> {
    const config = readTrustedCodexConfig(input.profile.configJson)
    const auth = this.resolveAppServerAuth(input.profile, config.apiKey)

    if (config.baseUrl && !auth.apiKey) {
      throw new ProviderRuntimeError(ProviderErrors.authFailed(this.runtimeKind))
    }

    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const workspacePath = snapshot.workspacePath ?? input.workspacePath
    const runtimeContext = resolveCodexRuntimeContext(workspacePath, snapshot.agentId ?? null)
    const effectiveModel = snapshot.models.currentModelId ?? config.model

    // Build minimal codex config for quick question. It still receives the full
    // transcript below, but it must not initialize tool or skill surfaces.
    const codexConfig = buildCodexConfig(config, workspacePath, this.resolveSkillPaths, null, effectiveModel)
    codexConfig.mcp = false
    codexConfig.computer_use = false
    codexConfig.use_bash = false
    delete codexConfig.mcp_servers

    const codexEnv = buildCradleCodexAppServerEnv({
      chatSessionId: input.runtimeSession.chatSessionId,
      workspaceId: input.workspaceId,
      workspacePath,
      agentId: snapshot.agentId ?? null,
      agentHome: runtimeContext.agentHome,
    })

    const hostLease = await this.acquireCodexAppServerHost({
      providerTargetId: input.profile.providerTargetId,
      scopeId: `${input.runtimeSession.chatSessionId}:btw:${randomUUID()}`,
      chatgptAuth: auth.chatgptAuth,
      pinned: false,
      options: {
        apiKey: auth.apiKey ?? undefined,
        config: codexConfig,
        env: codexEnv,
        serverRequestHandler: request => buildDefaultCodexAppServerRequestResult(request, {
          chatgptAuth: auth.chatgptAuth,
          updateSecretValue: this.deps.updateSecret,
        }),
      },
    })
    const client = hostLease.resource.client
    const abortController = new AbortController()
    const diagnostics = createCodexStreamDiagnostics()

    try {
      // Create ephemeral thread for this quick question
      let threadResponse: ThreadResponse
      try {
        threadResponse = await requestCodexAppServerWithTimeout(client, 'thread/start', {
          path: null,
          cwd: runtimeContext.cwd,
          runtimeWorkspaceRoots: runtimeContext.runtimeWorkspaceRoots,
          approvalPolicy: config.approvalPolicy,
          sandbox: config.sandboxMode,
          config: codexConfig,
          model: effectiveModel ?? null,
          ephemeral: true,
          threadSource: 'user',
        }, CODEX_EPHEMERAL_REQUEST_TIMEOUT_MS)
      }
      catch (error) {
        throw codexRequestError('thread/start', formatUnknownError(error))
      }

      const threadId = threadResponse.thread?.id
      if (!threadId) {
        throw codexRequestError('quickQuestion', 'Failed to create ephemeral thread')
      }

      // Inject transcript history to reuse prompt cache
      await injectCradleTranscriptHistory(client, threadId, input.transcript)

      // Submit the quick question
      const userInput = projectCodexUserInput(input.question, 'QuickQuestion')
      let turnResponse: TurnResponse
      try {
        turnResponse = await requestCodexAppServerWithTimeout(client, 'turn/start', {
          threadId,
          input: userInput,
          cwd: runtimeContext.cwd,
          runtimeWorkspaceRoots: runtimeContext.runtimeWorkspaceRoots,
          approvalPolicy: config.approvalPolicy,
          sandboxPolicy: toSandboxPolicy(config.sandboxMode, runtimeContext.runtimeWorkspaceRoots, config.additionalDirectories),
          model: effectiveModel,
          effort: null,
        }, CODEX_EPHEMERAL_REQUEST_TIMEOUT_MS)
      }
      catch (error) {
        throw codexRequestError('turn/start', formatUnknownError(error))
      }

      const turnId = turnResponse.turn?.id ?? turnResponse.turnId ?? null
      const textItemId = randomUUID()
      const mapperState = createCodexAppServerMapperState(textItemId)

      for await (const event of streamCodexMappedTurnEvents({
        client,
        threadId,
        turnId,
        signal: abortController.signal,
        mapperState,
        diagnostics,
        readGoal: () => null,
      })) {
        for (const chunk of event.chunks) {
          yield chunk
        }
      }

      for (const chunk of closeCodexMappedTurnChunks(mapperState, diagnostics)) {
        yield chunk
      }
    }
    finally {
      abortController.abort()
      hostLease.release()
    }
  }

  async getPresentation(_input: GetCapabilitiesInput): Promise<RuntimePresentationCapabilities> {
    return createCodexRuntimePresentation()
  }

  getDraftPresentation(): RuntimePresentationCapabilities {
    return createCodexRuntimePresentation()
  }

  getProviderNativeAppServerCapabilities(): ProviderNativeAppServerCapabilityManifest {
    return getCodexAppServerCapabilities()
  }

  async getContextUsage(input: GetContextUsageInput): Promise<RuntimeContextUsage | null> {
    return projectCodexEstimatedContextUsage({
      providerSessionId: input.runtimeSession.providerSessionId,
      providerStateSnapshot: input.runtimeSession.providerStateSnapshot,
      systemPrompt: input.systemPrompt ?? null,
      modelId: input.modelId ?? null,
      updatedAt: Date.now(),
    })
  }

  async invokeProviderNativeAppServer(
    input: ProviderNativeAppServerInvokeInput,
  ): Promise<ProviderNativeAppServerInvokeResponse> {
    const response = await this.createAppServerBridge().invoke(input)
    syncCodexProviderNativeAppServerSnapshot(input, response.result)
    return response
  }

  openProviderNativeAppServerStream(input: ProviderNativeAppServerStreamInput): ReadableStream<Uint8Array> {
    return this.createAppServerBridge().openEventStream(input)
  }

  async getUiSlotStates(input: GetUiSlotStatesInput): Promise<RuntimeUiSlotState[]> {
    const config = readTrustedCodexConfig(input.profile.configJson)
    const auth = this.resolveAppServerAuth(input.profile, config.apiKey)
    if (config.baseUrl && !auth.apiKey) {
      return []
    }

    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const workspacePath = snapshot.workspacePath ?? input.workspacePath
    const runtimeContext = resolveCodexRuntimeContext(workspacePath, input.agentId ?? snapshot.agentId ?? null)
    const skillExtraRoots = resolveCodexSkillExtraRoots(config, workspacePath, this.resolveSkillPaths)
    const runtimeSession = input.runtimeSession.providerSessionId
      ? input.runtimeSession
      : await this.resumeChatSession({
          runtimeSession: {
            ...input.runtimeSession,
            providerSessionId: null,
          },
          profile: input.profile,
          workspacePath: input.workspacePath,
          agentId: input.agentId,
          modelId: input.modelId,
        })
    if (!runtimeSession.providerSessionId) {
      return []
    }
    const hostLease = await this.acquireCodexAppServerHost({
      providerTargetId: input.profile.providerTargetId,
      scopeId: input.runtimeSession.chatSessionId,
      chatgptAuth: auth.chatgptAuth,
      options: {
        apiKey: auth.apiKey ?? undefined,
        config: buildCodexConfig(config, workspacePath, this.resolveSkillPaths, null, input.modelId ?? snapshot.models.currentModelId),
        env: buildCradleCodexAppServerEnv({
          chatSessionId: input.runtimeSession.chatSessionId,
          workspaceId: input.workspaceId,
          workspacePath,
          agentId: input.agentId ?? snapshot.agentId ?? null,
          agentHome: runtimeContext.agentHome,
        }),
        serverRequestHandler: request => buildDefaultCodexAppServerRequestResult(request, {
          chatgptAuth: auth.chatgptAuth,
          updateSecretValue: this.deps.updateSecret,
        }),
      },
    })
    const client = hostLease.resource.client

    try {
      await syncCodexSkillExtraRoots(client, skillExtraRoots)
      const [goalResult, configResult, providerCapabilitiesResult, modelListResult, mcpStatusResult, rateLimitsResult, configRequirementsResult, skillsResult, pluginResult, appsResult, collaborationModesResult] = await Promise.allSettled([
        client.request('thread/goal/get', {
          threadId: runtimeSession.providerSessionId,
        }) as Promise<ThreadGoalGetResponse>,
        client.request('config/read', {
          cwd: runtimeContext.cwd,
          includeLayers: false,
        }) as Promise<CodexConfigReadResponse>,
        client.request('modelProvider/capabilities/read', {}) as Promise<CodexModelProviderCapabilitiesReadResponse>,
        client.request('model/list', {
          includeHidden: true,
          limit: 100,
        }) as Promise<CodexModelListResponse>,
        client.request('mcpServerStatus/list', {
          threadId: runtimeSession.providerSessionId,
          limit: 100,
          detail: 'toolsAndAuthOnly',
        }) as Promise<CodexListMcpServerStatusResponse>,
        client.request('account/rateLimits/read', {}) as Promise<CodexRateLimitsResponse>,
        client.request('configRequirements/read', {}) as Promise<CodexConfigRequirementsReadResponse>,
        client.request('skills/list', {
          cwd: runtimeContext.cwd,
        }) as Promise<CodexSkillsListResponse>,
        client.request('plugin/list', {}) as Promise<CodexPluginListResponse>,
        client.request('app/list', {
          limit: 100,
        }) as Promise<CodexAppsListResponse>,
        client.request('collaborationMode/list', {}) as Promise<CodexCollaborationModeListResponse>,
      ])
      const configResponse = configResult.status === 'fulfilled' ? configResult.value : null
      const providerCapabilities = providerCapabilitiesResult.status === 'fulfilled' ? providerCapabilitiesResult.value : null
      const modelList = modelListResult.status === 'fulfilled' ? modelListResult.value : null
      const mcpStatus = mcpStatusResult.status === 'fulfilled' ? mcpStatusResult.value : null
      const rateLimits = rateLimitsResult.status === 'fulfilled' ? rateLimitsResult.value : null
      const configRequirements = configRequirementsResult.status === 'fulfilled' ? configRequirementsResult.value : null
      const skills = skillsResult.status === 'fulfilled' ? skillsResult.value : null
      const plugins = pluginResult.status === 'fulfilled' ? pluginResult.value : null
      const apps = appsResult.status === 'fulfilled' ? appsResult.value : null
      const collaborationModes = collaborationModesResult.status === 'fulfilled' ? collaborationModesResult.value : null
      return await projectCodexUiSlotStates({
        client,
        threadId: runtimeSession.providerSessionId,
        providerStateSnapshot: runtimeSession.providerStateSnapshot,
        goal: goalResult.status === 'fulfilled' ? goalResult.value.goal : undefined,
        configResponse,
        providerCapabilities,
        modelList,
        mcpStatus,
        rateLimits,
        configRequirements,
        skills,
        plugins,
        apps,
        collaborationModes,
      })
    }
    catch {
      return []
    }
    finally {
      hostLease.release()
    }
  }

  async listProviderThreads(input: ProviderThreadListInput): Promise<ProviderThreadListResult> {
    const context = await this.createProviderThreadClient(input)
    const parentThreadId = context.runtimeSession.providerSessionId
    if (!parentThreadId) {
      context.hostLease.release()
      return {
        runtimeKind: this.runtimeKind,
        providerSessionId: null,
        threads: [],
        nextCursor: null,
        backwardsCursor: null,
      }
    }

    try {
      const parent = await context.client.request('thread/read', {
        threadId: parentThreadId,
        includeTurns: false,
      }) as ThreadReadResponse
      const parentThread = parent.thread
      const params: ThreadListParams = {
        cursor: input.cursor ?? null,
        limit: input.limit ?? 50,
        sortKey: input.sortKey ?? 'updated_at',
        sortDirection: input.sortDirection ?? 'desc',
        sourceKinds: input.sourceKinds?.map(toCodexThreadSourceKind) ?? ['subAgentThreadSpawn'],
        archived: input.archived ?? false,
        cwd: context.workspacePath,
        searchTerm: input.searchTerm ?? null,
      }
      const response = await context.client.request('thread/list', params) as ThreadListResponse
      return {
        runtimeKind: this.runtimeKind,
        providerSessionId: parentThreadId,
        threads: (response.data ?? [])
          .filter(thread => codexThreadBelongsToRuntimeParent(parentThread, thread))
          .map(projectCodexThread),
        nextCursor: response.nextCursor ?? null,
        backwardsCursor: response.backwardsCursor ?? null,
      }
    }
    finally {
      context.hostLease.release()
    }
  }

  async readProviderThread(input: ProviderThreadReadInput): Promise<ProviderThreadReadResult> {
    const context = await this.createProviderThreadClient(input)
    try {
      const response = await context.client.request('thread/read', {
        threadId: input.threadId,
        includeTurns: input.includeTurns ?? false,
      }) as ThreadReadResponse
      await assertCodexThreadBelongsToRuntimeSession(context.client, context.runtimeSession.providerSessionId, response.thread)
      return {
        runtimeKind: this.runtimeKind,
        providerSessionId: context.runtimeSession.providerSessionId,
        thread: projectCodexThread(response.thread),
      }
    }
    finally {
      context.hostLease.release()
    }
  }

  async listProviderThreadTurns(input: ProviderThreadTurnsInput): Promise<ProviderThreadTurnsResult> {
    const context = await this.createProviderThreadClient(input)
    try {
      const threadResponse = await context.client.request('thread/read', {
        threadId: input.threadId,
        includeTurns: false,
      }) as ThreadReadResponse
      await assertCodexThreadBelongsToRuntimeSession(context.client, context.runtimeSession.providerSessionId, threadResponse.thread)
      const response = await context.client.request('thread/turns/list', {
        threadId: input.threadId,
        cursor: input.cursor ?? null,
        limit: input.limit ?? 50,
        sortDirection: input.sortDirection ?? 'asc',
        itemsView: 'full',
      }) as ThreadTurnsListResponse
      const turns = response.data ?? []
      return {
        runtimeKind: this.runtimeKind,
        providerSessionId: context.runtimeSession.providerSessionId,
        threadId: input.threadId,
        turns: turns.map(projectCodexTurn),
        messages: projectCodexTurnsToUiMessages(input.threadId, turns),
        nextCursor: response.nextCursor ?? null,
        backwardsCursor: response.backwardsCursor ?? null,
      }
    }
    finally {
      context.hostLease.release()
    }
  }

  private async createProviderThreadClient(input: GetCapabilitiesInput): Promise<{
    client: CodexAppServerClientLike
    hostLease: ProviderRuntimeLease<CodexAppServerHostResource>
    runtimeSession: RuntimeSession
    workspacePath: string
  }> {
    const config = readTrustedCodexConfig(input.profile.configJson)
    const auth = this.resolveAppServerAuth(input.profile, config.apiKey)
    if (config.baseUrl && !auth.apiKey) {
      throw new ProviderRuntimeError(ProviderErrors.authFailed(this.runtimeKind))
    }

    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const workspacePath = snapshot.workspacePath ?? input.workspacePath
    const agentId = input.agentId ?? snapshot.agentId ?? null
    const runtimeContext = resolveCodexRuntimeContext(workspacePath, agentId)
    const runtimeSession = input.runtimeSession.providerSessionId
      ? input.runtimeSession
      : await this.resumeChatSession({
          runtimeSession: input.runtimeSession,
          profile: input.profile,
          workspacePath,
          agentId,
          modelId: input.modelId,
        })

    const hostLease = await this.acquireCodexAppServerHost({
      providerTargetId: input.profile.providerTargetId,
      scopeId: input.runtimeSession.chatSessionId,
      chatgptAuth: auth.chatgptAuth,
      options: {
        apiKey: auth.apiKey ?? undefined,
        config: buildCodexConfig(config, workspacePath, this.resolveSkillPaths, null, input.modelId ?? snapshot.models.currentModelId),
        env: buildCradleCodexAppServerEnv({
          chatSessionId: input.runtimeSession.chatSessionId,
          workspaceId: input.workspaceId,
          workspacePath,
          agentId,
          agentHome: runtimeContext.agentHome,
        }),
        serverRequestHandler: request => buildDefaultCodexAppServerRequestResult(request, {
          chatgptAuth: auth.chatgptAuth,
          updateSecretValue: this.deps.updateSecret,
        }),
      },
    })
    return { client: hostLease.resource.client, hostLease, runtimeSession, workspacePath }
  }

  async executeShellCommand(input: ExecuteShellCommandInput): Promise<ExecuteShellCommandResult> {
    const command = input.command.trim()
    if (!command) {
      throw new ProviderRuntimeError(ProviderErrors.requestFailed(this.runtimeKind, 'executeShellCommand', 'Codex shell command must not be empty'))
    }

    const config = readTrustedCodexConfig(input.profile.configJson)
    const auth = this.resolveAppServerAuth(input.profile, config.apiKey)
    if (config.baseUrl && !auth.apiKey) {
      throw new ProviderRuntimeError(ProviderErrors.authFailed(this.runtimeKind))
    }

    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const workspacePath = snapshot.workspacePath ?? input.workspacePath
    const agentId = input.agentId ?? snapshot.agentId ?? null
    const runtimeContext = resolveCodexRuntimeContext(workspacePath, agentId)
    const effectiveModel = input.modelId ?? snapshot.models.currentModelId ?? config.model
    const skillExtraRoots = resolveCodexSkillExtraRoots(config, workspacePath, this.resolveSkillPaths)
    const codexConfig = buildCodexConfig(config, workspacePath, this.resolveSkillPaths, null, effectiveModel)
    const hostLease = await this.acquireCodexAppServerHost({
      providerTargetId: input.profile.providerTargetId,
      scopeId: input.runtimeSession.chatSessionId,
      chatgptAuth: auth.chatgptAuth,
      options: {
        apiKey: auth.apiKey ?? undefined,
        config: codexConfig,
        env: buildCradleCodexAppServerEnv({
          chatSessionId: input.runtimeSession.chatSessionId,
          workspaceId: input.workspaceId,
          workspacePath,
          agentId,
          agentHome: runtimeContext.agentHome,
        }),
        serverRequestHandler: request => buildDefaultCodexAppServerRequestResult(request, {
          chatgptAuth: auth.chatgptAuth,
          updateSecretValue: this.deps.updateSecret,
        }),
      },
    })
    const client = hostLease.resource.client
    const startedAt = Date.now()

    try {
      await syncCodexSkillExtraRoots(client, skillExtraRoots)
      const threadStart = await startOrResumeThread(client, input.runtimeSession, {
        model: effectiveModel,
        cwd: runtimeContext.cwd,
        runtimeWorkspaceRoots: runtimeContext.runtimeWorkspaceRoots,
        approvalPolicy: config.approvalPolicy,
        sandbox: config.sandboxMode,
        config: codexConfig,
      })
      const threadId = threadStart.threadId
      input.runtimeSession.providerSessionId = threadId
      this._lastModelId = threadStart.modelId ?? effectiveModel ?? null
      writeCodexThreadSnapshot(input.runtimeSession, threadStart)

      await client.request('thread/shellCommand', { threadId, command })
      const result = await waitForCodexShellCommandCompletion(client, {
        threadId,
        command,
        signal: input.signal,
      })
      await hydrateCodexNativeHistory(client, input.runtimeSession, threadId)

      const output = result.item.aggregatedOutput ?? result.output ?? ''
      return {
        command: result.item.command ?? command,
        stdout: output,
        stderr: '',
        exitCode: result.item.exitCode ?? null,
        durationMs: result.item.durationMs ?? Math.max(0, Date.now() - startedAt),
        timedOut: false,
        truncated: output.endsWith('...<truncated>'),
      }
    }
    finally {
      hostLease.release()
    }
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    const config = readTrustedCodexConfig(input.profile.configJson)
    const auth = this.resolveAppServerAuth(input.profile, config.apiKey)
    const effectiveModel = input.modelId ?? config.model
    const userInput = projectCodexUserInput(input.message, 'Codex provider')
    const userPromptText = extractUiMessageText(input.message).trim()
    const goalContinuationRequested = typeof input.message !== 'string' && isCodexGoalContinuationMessage(input.message)
    const goalCommandObjective = readCodexGoalCommandObjective(input.message)
    const compactCommandRequested = isCodexCompactCommand(input.message)
    if (config.baseUrl && !auth.apiKey) {
      throw new ProviderRuntimeError(ProviderErrors.authFailed(this.runtimeKind))
    }

    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const workspacePath = snapshot.workspacePath ?? '.'
    const runtimeContext = resolveCodexRuntimeContext(workspacePath, input.agentId ?? snapshot.agentId ?? null)
    const systemPromptFile = writeSystemPromptFile(input.systemPrompt)
    const runtimeSettings = input.providerOptions?.runtimeSettings
    const requestedReasoningEffort = readCodexReasoningEffort(input.providerOptions?.thinkingEffort, config.reasoningEffort)
    const runtimeAccess = runtimeSettings
      ? projectCodexRuntimeAccessMode(runtimeSettings.accessMode, {
          writableRoots: runtimeContext.runtimeWorkspaceRoots,
          additionalDirectories: config.additionalDirectories,
        })
      : null
    const skillExtraRoots = resolveCodexSkillExtraRoots(config, workspacePath, this.resolveSkillPaths)
    const codexConfig = buildCodexConfig(config, workspacePath, this.resolveSkillPaths, systemPromptFile, effectiveModel)
    if (runtimeAccess) {
      codexConfig.approval_policy = runtimeAccess.approvalPolicy
      codexConfig.sandbox_mode = runtimeAccess.sandbox
    }
    const codexEnv = buildCradleCodexAppServerEnv({
      chatSessionId: input.runtimeSession.chatSessionId,
      workspaceId: input.workspaceId,
      workspacePath,
      agentId: input.agentId ?? snapshot.agentId ?? null,
      agentHome: runtimeContext.agentHome,
    })
    const serverRequestHandler: CodexAppServerClientOptions['serverRequestHandler'] = request => this.handleCodexServerRequest(input, request, {
      chatgptAuth: auth.chatgptAuth,
      updateSecretValue: this.deps.updateSecret,
    })
    let hostLease: ProviderRuntimeLease<CodexAppServerHostResource> | null = null
    try {
      hostLease = await this.acquireCodexAppServerHost({
        providerTargetId: input.profile.providerTargetId,
        scopeId: input.runtimeSession.chatSessionId,
        chatgptAuth: auth.chatgptAuth,
        options: {
          apiKey: auth.apiKey ?? undefined,
          config: codexConfig,
          env: codexEnv,
          serverRequestHandler,
        },
      })
    }
    catch (error) {
      if (systemPromptFile) {
        try {
          unlinkSync(systemPromptFile)
        }
        catch { /* ignore */ }
      }
      throw error
    }
    const client = hostLease.resource.client
    const abortController = new AbortController()
    const sessionId = input.runtimeSession.chatSessionId
    const shouldInjectReconstructedHistory = !input.runtimeSession.providerSessionId
    const isFreshProviderThread = !input.runtimeSession.providerSessionId
    const isLiveSideFork = isLiveCodexSideFork(input.runtimeSession)
    this._lastUsage = null
    this._lastModelId = effectiveModel ?? null

    const textItemId = randomUUID()
    const mapperState = createCodexAppServerMapperState(textItemId)
    const providerThreadMapperStates = new Map<string, ReturnType<typeof createCodexAppServerMapperState>>()
    const diagnostics = createCodexStreamDiagnostics()
    let activeEntry: ActiveCodexTurn | null = null

    let generation: LangfuseGeneration | null = null
    if (aiTelemetryEnabled()) {
      generation = startObservation('codex-generation', {
        model: effectiveModel ?? 'codex',
        input: input.systemPrompt
          ? [{ role: 'system', content: input.systemPrompt }, { role: 'user', content: describeCodexUserInput(userInput, userPromptText) }]
          : [{ role: 'user', content: describeCodexUserInput(userInput, userPromptText) }],
      }, { asType: 'generation' }) as LangfuseGeneration
      const span = generation.otelSpan
      span.setAttribute('langfuse.session.id', input.runtimeSession.chatSessionId)
      span.setAttribute('langfuse.trace.name', 'codex-chat')
    }
    const outputTextCollector = createBoundedTextCollector()

    try {
      await syncCodexSkillExtraRoots(client, skillExtraRoots)
      const threadStart = isLiveSideFork
        ? readLiveSideForkThreadStart(input.runtimeSession, effectiveModel)
        : await startOrResumeThread(client, input.runtimeSession, {
            model: effectiveModel,
            cwd: runtimeContext.cwd,
            runtimeWorkspaceRoots: runtimeContext.runtimeWorkspaceRoots,
            approvalPolicy: runtimeAccess?.approvalPolicy ?? config.approvalPolicy,
            sandbox: runtimeAccess?.sandbox ?? config.sandboxMode,
            config: codexConfig,
          })
      const threadId = threadStart.threadId
      input.runtimeSession.providerSessionId = threadId
      this._lastModelId = threadStart.modelId ?? effectiveModel ?? null
      writeCodexThreadSnapshot(input.runtimeSession, threadStart)
      if (threadStart.title) {
        input.reportSessionTitle?.(threadStart.title)
      }
      activeEntry = {
        client,
        hostLease,
        abortController,
        threadId,
        turnId: null,
        modelId: effectiveModel ?? threadStart.modelId ?? config.model ?? null,
        reasoningEffort: requestedReasoningEffort ?? null,
      }
      this.activeTurns.set(sessionId, activeEntry)
      const shouldGenerateThreadTitle = shouldGenerateCodexThreadTitle({
        isFreshProviderThread,
        existingTitle: threadStart.title,
        promptText: goalCommandObjective ?? userPromptText,
        goalContinuationRequested,
        compactCommandRequested,
      })
      const generateThreadTitle = () => {
        if (!shouldGenerateThreadTitle) {
          return
        }
        const titleGeneration = this.resolveCodexThreadTitleGenerationConfig({
          currentAuth: auth,
          currentCodexConfig: codexConfig,
          workspacePath,
          fallbackModel: threadStart.modelId ?? effectiveModel ?? config.model ?? null,
        })
        this.generateCodexThreadTitleInBackground({
          providerTargetId: input.profile.providerTargetId,
          apiKey: titleGeneration.auth.apiKey ?? null,
          chatgptAuth: titleGeneration.auth.chatgptAuth,
          codexConfig: titleGeneration.codexConfig,
          codexEnv,
          mainClient: client,
          mainThreadId: threadId,
          promptText: goalCommandObjective ?? userPromptText,
          cwd: runtimeContext.cwd,
          runtimeWorkspaceRoots: runtimeContext.runtimeWorkspaceRoots,
          modelId: titleGeneration.model,
          fallbackModel: titleGeneration.fallbackModel,
          thinkingEffort: titleGeneration.thinkingEffort,
          reportSessionTitle: input.reportSessionTitle,
        })
      }
      if (shouldInjectReconstructedHistory) {
        await injectCodexNativeHistory(client, threadId, readCodexProviderSnapshot(input.runtimeSession.providerStateSnapshot).codex?.previousNativeHistory)
        await injectCradleTranscriptHistory(client, threadId, input.transcript?.history ?? input.history)
      }
      else if (!isLiveSideFork) {
        await hydrateCodexNativeHistory(client, input.runtimeSession, threadId)
      }

      let turnId: string | null = null
      if (goalContinuationRequested) {
        if (!hasActiveGoal(readCodexProviderSnapshot(input.runtimeSession.providerStateSnapshot).codex?.goal)) {
          return
        }
        activeEntry = {
          client,
          hostLease,
          abortController,
          threadId,
          turnId,
          modelId: effectiveModel ?? threadStart.modelId ?? config.model ?? null,
          reasoningEffort: requestedReasoningEffort ?? null,
        }
        this.activeTurns.set(sessionId, activeEntry)
        if (!await continueActiveGoal(client, threadId, abortController.signal)) {
          return
        }
      }
      else if (goalCommandObjective) {
        const goal = await setCodexThreadGoal(client, input.runtimeSession, threadId, goalCommandObjective)
        if (!hasActiveGoal(goal)) {
          return
        }
        activeEntry = {
          client,
          hostLease,
          abortController,
          threadId,
          turnId,
          modelId: effectiveModel ?? threadStart.modelId ?? config.model ?? null,
          reasoningEffort: requestedReasoningEffort ?? null,
        }
        this.activeTurns.set(sessionId, activeEntry)
        generateThreadTitle()
        if (!await continueActiveGoal(client, threadId, abortController.signal)) {
          return
        }
      }
      else if (compactCommandRequested) {
        await client.request('thread/compact/start', { threadId })
      }
      else {
        const turnResponse = await client.request('turn/start', {
          threadId,
          input: userInput,
          cwd: runtimeContext.cwd,
          runtimeWorkspaceRoots: runtimeContext.runtimeWorkspaceRoots,
          approvalPolicy: runtimeAccess?.approvalPolicy ?? config.approvalPolicy,
          sandboxPolicy: runtimeAccess?.sandboxPolicy ?? toSandboxPolicy(config.sandboxMode, runtimeContext.runtimeWorkspaceRoots, config.additionalDirectories),
          ...(runtimeSettings
            ? {
                collaborationMode: buildCodexCollaborationMode(runtimeSettings, {
                  model: effectiveModel ?? config.model ?? null,
                  effort: requestedReasoningEffort,
                }),
              }
            : {}),
          model: effectiveModel,
          effort: requestedReasoningEffort,
        }) as TurnResponse
        turnId = turnResponse.turn?.id ?? turnResponse.turnId ?? null
        generateThreadTitle()
      }
      if (activeEntry) {
        activeEntry.turnId = turnId
      }
      else {
        activeEntry = {
          client,
          hostLease,
          abortController,
          threadId,
          turnId,
          modelId: effectiveModel ?? threadStart.modelId ?? config.model ?? null,
          reasoningEffort: requestedReasoningEffort ?? null,
        }
        this.activeTurns.set(sessionId, activeEntry)
      }

      for await (const event of streamCodexMappedTurnEvents({
        client,
        threadId,
        turnId,
        signal: abortController.signal,
        mapperState,
        diagnostics,
        readGoal: () => readCodexProviderSnapshot(input.runtimeSession.providerStateSnapshot).codex?.goal ?? null,
        onProviderNotification: providerNotification => publishProviderThreadEvent(input.onProviderThreadEvent, providerNotification, providerThreadMapperStates),
      })) {
        const { notification } = event
        for (const chunk of event.chunks) {
          if (generation && chunk.type === 'text-delta' && 'delta' in chunk) {
            outputTextCollector.append((chunk as { delta: string }).delta)
          }
          yield chunk
        }

        if (notification.method === 'turn/started') {
          activeEntry.turnId = getTurnId(notification) ?? activeEntry.turnId
        }
        if (notification.method === 'thread/name/updated') {
          const title = readThreadNameUpdate(notification, threadId)
          if (title) {
            input.reportSessionTitle?.(title)
          }
        }
        projectCodexProviderStateSnapshot(input.runtimeSession, notification, threadId)
        this.captureLastTokenUsage(notification)
        if (isCompletedGoalUpdate(notification)) {
          await client.request('thread/goal/clear', { threadId }).catch(() => undefined)
        }
      }
      const finalTitle = await readLatestThreadTitle(client, threadId)
      if (finalTitle) {
        input.reportSessionTitle?.(finalTitle)
      }
      if (!isLiveSideFork) {
        await hydrateCodexNativeHistory(client, input.runtimeSession, threadId)
      }

      for (const chunk of closeCodexMappedTurnChunks(mapperState, diagnostics)) {
        yield chunk
      }

      const validation = validateCodexStreamOutput(diagnostics)
      if (!validation.ok) {
        const errorText = validation.errorText ?? 'Codex app-server stream produced no timeline output events'
        this.recordObservability({
          source: 'provider',
          code: OBSERVABILITY_CODES.providerEmptyEventStream,
          severity: 'error',
          category: 'provider',
          message: errorText,
          chatSessionId: input.runtimeSession.chatSessionId,
          dedupeKey: createDedupeKey({
            code: OBSERVABILITY_CODES.providerEmptyEventStream,
            chatSessionId: input.runtimeSession.chatSessionId,
            runId: null,
          }),
          attrs: { runtimeKind: RUNTIME_KIND, diagnostics, model: effectiveModel, baseUrl: config.baseUrl },
        })
        throw createCodexEmptyStreamError(errorText, diagnostics)
      }

      if (generation) {
        const update: Parameters<LangfuseGeneration['update']>[0] = {
          output: outputTextCollector.read(),
        }
        generation.update(update)
      }
      generation?.end()
    }
    catch (error) {
      if (generation) {
        generation.update({
          level: 'ERROR',
          statusMessage: error instanceof Error ? error.message : String(error),
        })
        generation.end()
      }
      throw error
    }
    finally {
      if (activeEntry) {
        this.releaseTurn(sessionId, activeEntry)
      }
      if (!activeEntry) {
        hostLease?.release()
      }
      if (systemPromptFile) {
        try {
          unlinkSync(systemPromptFile)
        }
        catch { /* ignore */ }
      }
    }
  }

  private async handleCodexServerRequest(
    input: StreamTurnInput,
    request: Parameters<NonNullable<CodexAppServerClientOptions['serverRequestHandler']>>[0],
    options: {
      chatgptAuth?: CodexChatgptAuthCredential | null
      updateSecretValue?: (credentialRef: string, secret: string) => void
    },
  ): Promise<unknown> {
    if (request.method !== 'item/tool/requestUserInput' && request.method !== 'mcpServer/elicitation/request') {
      return await buildDefaultCodexAppServerRequestResult(request, options)
    }
    if (!this.deps.requestUserInput) {
      throw codexRequestError(request.method, 'Chat Runtime does not expose pending user input handling')
    }

    const requestId = String(request.id)
    const resolution = await this.deps.requestUserInput({
      sessionId: input.runtimeSession.chatSessionId,
      runId: input.runId,
      providerRequestId: requestId,
      providerKind: input.profile.providerKind,
      runtimeKind: RUNTIME_KIND,
      providerMethod: request.method,
      toolCallId: `server-request-${request.id}`,
      questions: request.method === 'mcpServer/elicitation/request'
        ? readCodexMcpElicitationQuestions(request.params)
        : readCodexUserInputQuestions(request.params),
      metadata: {
        params: request.params,
      },
    })

    if (request.method === 'mcpServer/elicitation/request') {
      return buildCodexMcpElicitationResponse(request.params, resolution.answers)
    }

    return {
      answers: Object.fromEntries(
        Object.entries(resolution.answers).map(([questionId, answers]) => [questionId, { answers }]),
      ),
    }
  }

  async steerTurn(input: SteerTurnInput): Promise<void> {
    const entry = this.activeTurns.get(input.runtimeSession.chatSessionId)
    if (!entry?.turnId) {
      throw new ProviderRuntimeError(ProviderErrors.sessionNotFound(this.runtimeKind, input.runtimeSession.chatSessionId))
    }
    const userInput = projectCodexUserInput(input.message, 'Codex provider live steer')
    await entry.client.request('turn/steer', {
      threadId: entry.threadId,
      expectedTurnId: entry.turnId,
      input: userInput,
    })
  }

  async updateRuntimeSettings(input: UpdateRuntimeSettingsInput): Promise<void> {
    const entry = this.activeTurns.get(input.runtimeSession.chatSessionId)
    if (!entry) {
      return
    }
    const config = readTrustedCodexConfig(input.profile.configJson)
    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const runtimeContext = resolveCodexRuntimeContext(snapshot.workspacePath ?? '.', snapshot.agentId ?? null)
    const access = projectCodexRuntimeAccessMode(input.settings.accessMode, {
      writableRoots: runtimeContext.runtimeWorkspaceRoots,
      additionalDirectories: config.additionalDirectories,
    })
    await entry.client.request('thread/settings/update', {
      threadId: entry.threadId,
      approvalPolicy: access.approvalPolicy,
      sandboxPolicy: access.sandboxPolicy,
      collaborationMode: buildCodexCollaborationMode(input.settings, {
        model: entry.modelId ?? snapshot.models.currentModelId ?? config.model ?? null,
        effort: entry.reasoningEffort ?? config.reasoningEffort,
      }),
    })
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const sessionId = input.runtimeSession.chatSessionId
    const entry = this.activeTurns.get(sessionId)
    if (!entry) {
      return
    }
    if (hasActiveGoal(readCodexProviderSnapshot(input.runtimeSession.providerStateSnapshot).codex?.goal)) {
      await entry.client.request('thread/goal/set', {
        threadId: entry.threadId,
        status: 'paused',
      }).catch(() => undefined)
      pauseCodexGoalSnapshot(input.runtimeSession)
    }
    entry.abortController.abort()
    if (entry.turnId) {
      await entry.client.request('turn/interrupt', {
        threadId: entry.threadId,
        turnId: entry.turnId,
      }).catch(() => undefined)
    }
    this.releaseTurn(sessionId, entry)
  }

  private configureAppServerClientOptions(options: CodexAppServerClientOptions): CodexAppServerClientOptions {
    const userAgentMode = this.deps.readCodexPreferences?.().useCradleUserAgent === false ? 'native' : 'cradle'
    return { ...options, userAgentMode } satisfies CodexAppServerClientOptions
  }

  private createAppServerBridge(): CodexAppServerBridge {
    return new CodexAppServerBridge({
      readSecret: credentialRef => this.deps.readSecret(credentialRef),
      updateSecretValue: this.deps.updateSecret,
      resolveSkillPaths: this.resolveSkillPaths,
      createAppServerClient: this.deps.createAppServerClient,
      readCodexPreferences: this.deps.readCodexPreferences,
    })
  }

  private resolveAppServerAuth(
    profile: CodexAppServerAuthCarrier,
    configApiKey: string | undefined,
  ): CodexAppServerAuthResolution {
    return resolveCodexAppServerAuth(profile, configApiKey, 'OPENAI_API_KEY', this.deps)
  }

  private async acquireCodexAppServerHost(input: {
    providerTargetId: string
    scopeId: string
    options: CodexAppServerClientOptions
    chatgptAuth: CodexChatgptAuthCredential | null
    pinned?: boolean
  }): Promise<ProviderRuntimeLease<CodexAppServerHostResource>> {
    const clientOptions = this.configureAppServerClientOptions(input.options)
    const { serverRequestHandler, ...hostClientOptions } = clientOptions
    const lease = await providerRuntimeHostManager.acquireResource({
      runtimeKind: this.runtimeKind,
      providerTargetId: input.providerTargetId,
      scopeId: input.scopeId,
      pinned: input.pinned ?? false,
      resourceFingerprint: createCodexAppServerHostFingerprint({
        options: hostClientOptions,
        chatgptAuth: input.chatgptAuth,
      }),
      createResource: (): CodexAppServerHostResource => createCodexAppServerHostResource({
        clientOptions: hostClientOptions,
        createClient: clientOptions => this.deps.createAppServerClient?.(clientOptions) ?? new CodexAppServerClient(clientOptions),
      }),
      disposeResource: resource => resource.client.close(),
    })
    const releaseRequestHandler = serverRequestHandler
      ? addCodexAppServerHostRequestHandler(lease.resource, serverRequestHandler)
      : () => undefined
    const releaseHost = lease.release.bind(lease)
    lease.release = () => {
      releaseRequestHandler()
      releaseHost()
    }
    try {
      lease.resource.initialized ??= this.initializeAppServerClient(lease.resource.client, input.chatgptAuth)
      await lease.resource.initialized
      return lease
    }
    catch (error) {
      providerRuntimeHostManager.invalidateResource(lease.hostId)
      lease.release()
      throw error
    }
  }

  private resolveCodexThreadTitleGenerationConfig(input: {
    currentAuth: CodexAppServerAuthResolution
    currentCodexConfig: Record<string, unknown>
    workspacePath: string
    fallbackModel: string | null
  }): {
      auth: CodexAppServerAuthResolution
      codexConfig: Record<string, unknown>
      model: string | null
      fallbackModel: string | null
      thinkingEffort: CodexTitleGenerationThinkingEffort
    } {
    const preferences = this.deps.readChatPreferences?.()
    const titlePreferences = preferences?.titleGeneration
    const thinkingEffort = titlePreferences?.thinkingEffort ?? 'minimal'
    const explicitProviderTargetId = titlePreferences?.providerTargetId ?? null
    const explicitModelId = titlePreferences?.modelId ?? null

    if (!explicitProviderTargetId) {
      return {
        auth: input.currentAuth,
        codexConfig: input.currentCodexConfig,
        model: null,
        fallbackModel: input.fallbackModel,
        thinkingEffort,
      }
    }

    const profile = this.deps.resolveProviderTargetProfile?.(explicitProviderTargetId)
    if (!profile) {
      return {
        auth: input.currentAuth,
        codexConfig: input.currentCodexConfig,
        model: explicitModelId,
        fallbackModel: input.fallbackModel,
        thinkingEffort,
      }
    }

    const config = readTrustedCodexConfig(profile.configJson)
    const model = explicitModelId ?? config.model ?? null
    return {
      auth: this.resolveAppServerAuth(profile, config.apiKey),
      codexConfig: buildCodexConfig(config, input.workspacePath, this.resolveSkillPaths, null, model),
      model,
      fallbackModel: config.model ?? input.fallbackModel,
      thinkingEffort,
    }
  }

  private async initializeAppServerClient(
    client: CodexAppServerClientLike,
    chatgptAuth: CodexChatgptAuthCredential | null,
  ): Promise<void> {
    await client.initialize()
    if (!chatgptAuth) {
      return
    }
    const credential = await ensureCodexChatgptAuthAccessToken(chatgptAuth, {
      updateSecretValue: this.deps.updateSecret,
    })
    await client.request('account/login/start', buildCodexChatgptAuthLoginParams(credential))
  }

  private generateCodexThreadTitleInBackground(input: {
    providerTargetId: string
    apiKey: string | null
    chatgptAuth: CodexChatgptAuthCredential | null
    codexConfig: Record<string, unknown>
    codexEnv: Record<string, string>
    mainClient: CodexAppServerClientLike
    mainThreadId: string
    promptText: string
    cwd: string
    runtimeWorkspaceRoots: string[]
    modelId: string | null
    fallbackModel: string | null
    thinkingEffort: CodexTitleGenerationThinkingEffort
    reportSessionTitle?: (title: string) => void
  }): void {
    setTimeout(() => {
      const model = input.modelId ?? input.fallbackModel
      const titleCodexConfig = buildCodexTitleConfig(input.codexConfig, model)
      const abortController = new AbortController()
      void (async () => {
        let hostLease: ProviderRuntimeLease<CodexAppServerHostResource> | null = null
        try {
          hostLease = await this.acquireCodexAppServerHost({
            providerTargetId: input.providerTargetId,
            scopeId: `title:${input.mainThreadId}:${randomUUID()}`,
            chatgptAuth: input.chatgptAuth,
            options: {
              apiKey: input.apiKey ?? undefined,
              config: titleCodexConfig,
              env: input.codexEnv,
              serverRequestHandler: request => buildDefaultCodexAppServerRequestResult(request, {
                chatgptAuth: input.chatgptAuth,
                updateSecretValue: this.deps.updateSecret,
              }),
            },
          })
          const client = hostLease.resource.client
          const generatedTitle = await generateAndSetCodexThreadTitle(client, input.mainClient, {
            mainThreadId: input.mainThreadId,
            promptText: input.promptText,
            cwd: input.cwd,
            runtimeWorkspaceRoots: input.runtimeWorkspaceRoots,
            modelId: input.modelId,
            fallbackModel: input.fallbackModel,
            thinkingEffort: input.thinkingEffort,
            config: titleCodexConfig,
            signal: abortController.signal,
          })
          if (generatedTitle) {
            input.reportSessionTitle?.(generatedTitle)
          }
        }
        catch {
          // Title generation is opportunistic and must not affect the active turn.
        }
        finally {
          abortController.abort()
          hostLease?.release()
        }
      })()
    }, 0)
  }

  async generateSessionTitle(input: GenerateSessionTitleInput): Promise<string | null> {
    const config = readTrustedCodexConfig(input.profile.configJson)
    const auth = this.resolveAppServerAuth(input.profile, config.apiKey)
    if (config.baseUrl && !auth.apiKey) {
      throw new ProviderRuntimeError(ProviderErrors.authFailed(this.runtimeKind))
    }

    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const workspacePath = snapshot.workspacePath ?? input.workspacePath
    const agentId = input.agentId ?? snapshot.agentId ?? null
    const runtimeContext = resolveCodexRuntimeContext(workspacePath, agentId)
    const effectiveModel = input.modelId ?? snapshot.models.currentModelId ?? config.model ?? null
    const codexConfig = buildCodexConfig(config, workspacePath, this.resolveSkillPaths, null, effectiveModel)
    const codexEnv = buildCradleCodexAppServerEnv({
      chatSessionId: input.runtimeSession.chatSessionId,
      workspaceId: input.workspaceId,
      workspacePath,
      agentId,
      agentHome: runtimeContext.agentHome,
    })
    const mainHostLease = await this.acquireCodexAppServerHost({
      providerTargetId: input.profile.providerTargetId,
      scopeId: input.runtimeSession.chatSessionId,
      chatgptAuth: auth.chatgptAuth,
      options: {
        apiKey: auth.apiKey ?? undefined,
        config: codexConfig,
        env: codexEnv,
        serverRequestHandler: request => buildDefaultCodexAppServerRequestResult(request, {
          chatgptAuth: auth.chatgptAuth,
          updateSecretValue: this.deps.updateSecret,
        }),
      },
    })
    const abortController = new AbortController()
    let titleHostLease: ProviderRuntimeLease<CodexAppServerHostResource> | null = null

    try {
      const mainClient = mainHostLease.resource.client
      const threadStart = await startOrResumeThread(mainClient, input.runtimeSession, {
        model: effectiveModel,
        cwd: runtimeContext.cwd,
        runtimeWorkspaceRoots: runtimeContext.runtimeWorkspaceRoots,
        approvalPolicy: config.approvalPolicy,
        sandbox: config.sandboxMode,
        config: codexConfig,
      })
      input.runtimeSession.providerSessionId = threadStart.threadId
      this._lastModelId = threadStart.modelId ?? effectiveModel
      writeCodexThreadSnapshot(input.runtimeSession, threadStart)

      const titleGeneration = this.resolveCodexThreadTitleGenerationConfig({
        currentAuth: auth,
        currentCodexConfig: codexConfig,
        workspacePath,
        fallbackModel: threadStart.modelId ?? effectiveModel,
      })
      const titleModel = titleGeneration.model ?? titleGeneration.fallbackModel
      const titleCodexConfig = buildCodexTitleConfig(titleGeneration.codexConfig, titleModel)
      titleHostLease = await this.acquireCodexAppServerHost({
        providerTargetId: input.profile.providerTargetId,
        scopeId: `title:${threadStart.threadId}:${randomUUID()}`,
        chatgptAuth: titleGeneration.auth.chatgptAuth,
        options: {
          apiKey: titleGeneration.auth.apiKey ?? undefined,
          config: titleCodexConfig,
          env: codexEnv,
          serverRequestHandler: request => buildDefaultCodexAppServerRequestResult(request, {
            chatgptAuth: titleGeneration.auth.chatgptAuth,
            updateSecretValue: this.deps.updateSecret,
          }),
        },
      })

      return await generateAndSetCodexThreadTitleOrThrow(titleHostLease.resource.client, mainClient, {
        mainThreadId: threadStart.threadId,
        promptText: input.promptText,
        cwd: runtimeContext.cwd,
        runtimeWorkspaceRoots: runtimeContext.runtimeWorkspaceRoots,
        modelId: titleGeneration.model,
        fallbackModel: titleGeneration.fallbackModel,
        thinkingEffort: titleGeneration.thinkingEffort,
        config: titleCodexConfig,
        signal: abortController.signal,
      })
    }
    finally {
      abortController.abort()
      titleHostLease?.release()
      mainHostLease.release()
    }
  }

  private captureLastTokenUsage(notification: CodexAppServerMessage): void {
    if (notification.method !== 'thread/tokenUsage/updated') {
      return
    }
    const params = notification.params as ThreadTokenUsageUpdatedNotificationParams | undefined
    const usage = readCodexLastTokenUsage(params?.tokenUsage)
    if (usage) {
      this._lastUsage = usage
    }
  }
}

function readCodexReasoningEffort(
  override: ChatThinkingEffort | undefined,
  configured: CodexConfig['reasoningEffort'],
): ReasoningEffort {
  switch (override) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return override
    default:
      return isCodexReasoningEffort(configured) ? configured : 'high'
  }
}

function isCodexReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === 'none'
    || value === 'minimal'
    || value === 'low'
    || value === 'medium'
    || value === 'high'
    || value === 'xhigh'
}

function readCodexUserInputQuestions(params: unknown): RuntimeUserInputQuestion[] {
  const record = readRecord(params)
  const questions = Array.isArray(record.questions) ? record.questions : []
  return questions.map((item, index) => {
    const question = readRecord(item)
    const options = Array.isArray(question.options)
      ? question.options.map((option) => {
          const optionRecord = readRecord(option)
          return {
            label: readString(optionRecord.label, ''),
            description: readString(optionRecord.description, ''),
          }
        })
      : null
    const fallbackId = `question-${index + 1}`
    return {
      id: readString(question.id, fallbackId),
      header: readString(question.header, ''),
      question: readString(question.question, ''),
      isOther: question.isOther === true,
      isSecret: question.isSecret === true,
      options,
    }
  })
}

function readCodexMcpElicitationQuestions(params: unknown): RuntimeUserInputQuestion[] {
  const record = readRecord(params)
  const mode = readString(record.mode, 'form')
  const message = readString(record.message, '')
  if (mode === 'url') {
    return [{
      id: 'action',
      header: readString(record.serverName, 'MCP elicitation'),
      question: message || readString(record.url, 'Open the requested URL?'),
      isOther: false,
      isSecret: false,
      options: [
        { label: 'accept', description: readString(record.url, '') },
        { label: 'decline', description: 'Decline this MCP elicitation' },
      ],
    }]
  }

  const schema = readRecord(record.requestedSchema)
  const properties = readRecord(schema.properties)
  const entries = Object.entries(properties)
  if (entries.length === 0) {
    return [{
      id: 'content',
      header: readString(record.serverName, 'MCP elicitation'),
      question: message || 'MCP server requested user input.',
      isOther: false,
      isSecret: false,
      options: null,
    }]
  }

  return entries.map(([id, value]) => {
    const property = readRecord(value)
    return {
      id,
      header: readString(property.title, id),
      question: readString(property.description, message || id),
      isOther: false,
      isSecret: readString(property.format, '') === 'password',
      options: readMcpElicitationOptions(property),
    }
  })
}

function readMcpElicitationOptions(property: Record<string, unknown>): Array<{ label: string, description: string }> | null {
  if (Array.isArray(property.enum)) {
    const names = Array.isArray(property.enumNames) ? property.enumNames : []
    return property.enum.flatMap((value, index) => {
      if (typeof value !== 'string') {
        return []
      }
      return [{
        label: value,
        description: typeof names[index] === 'string' ? names[index] : '',
      }]
    })
  }

  if (Array.isArray(property.oneOf)) {
    return property.oneOf.flatMap((option) => {
      const optionRecord = readRecord(option)
      const value = readString(optionRecord.const, '')
      if (!value) {
        return []
      }
      return [{
        label: value,
        description: readString(optionRecord.title, ''),
      }]
    })
  }

  const items = readRecord(property.items)
  if (Array.isArray(items.enum)) {
    return items.enum.flatMap(value => typeof value === 'string'
      ? [{ label: value, description: '' }]
      : [])
  }

  if (Array.isArray(items.anyOf)) {
    return items.anyOf.flatMap((option) => {
      const optionRecord = readRecord(option)
      const value = readString(optionRecord.const, '')
      if (!value) {
        return []
      }
      return [{
        label: value,
        description: readString(optionRecord.title, ''),
      }]
    })
  }

  if (property.type === 'boolean') {
    return [
      { label: 'true', description: 'Yes' },
      { label: 'false', description: 'No' },
    ]
  }

  return null
}

function buildCodexMcpElicitationResponse(params: unknown, answers: Record<string, string[]>): unknown {
  const record = readRecord(params)
  if (record.mode === 'url') {
    const action = answers.action?.[0] === 'decline' ? 'decline' : 'accept'
    return { action, content: null, _meta: null }
  }

  return {
    action: 'accept',
    content: buildCodexMcpElicitationContent(record, answers),
    _meta: null,
  }
}

function buildCodexMcpElicitationContent(params: Record<string, unknown>, answers: Record<string, string[]>): Record<string, unknown> {
  const schema = readRecord(params.requestedSchema)
  const properties = readRecord(schema.properties)
  return Object.fromEntries(
    Object.entries(answers).flatMap(([key, value]) => {
      if (value.length === 0) {
        return []
      }
      return [[key, readMcpElicitationAnswerValue(readRecord(properties[key]), value)]]
    }),
  )
}

function readMcpElicitationAnswerValue(property: Record<string, unknown>, value: string[]): unknown {
  switch (property.type) {
    case 'boolean':
      return value[0] === 'true'
    case 'integer':
      return Math.trunc(Number(value[0]))
    case 'number':
      return Number(value[0])
    case 'array':
      return value
    default:
      return value.length === 1 ? value[0] : value
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

async function waitForCodexShellCommandCompletion(
  client: CodexAppServerClientLike,
  input: {
    threadId: string
    command: string
    signal?: AbortSignal
  },
): Promise<{ item: CodexThreadItem, output: string }> {
  const output = createBoundedTextCollector()
  const controller = new AbortController()
  let timedOut = false
  let commandItemId: string | null = null

  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, CODEX_SHELL_COMMAND_RESULT_TIMEOUT_MS)
  const abort = () => controller.abort()
  input.signal?.addEventListener('abort', abort, { once: true })

  try {
    while (true) {
      const notification = await readCodexShellCommandNotification(client, controller.signal, () => {
        if (input.signal?.aborted) {
          throw new DOMException('Codex shell command aborted', 'AbortError')
        }
        if (timedOut) {
          throw new CodexProviderError('codex_shell_command_timeout', 'Timed out waiting for Codex shell command completion', {
            threadId: input.threadId,
            command: input.command,
            timeoutMs: CODEX_SHELL_COMMAND_RESULT_TIMEOUT_MS,
          })
        }
      })
      if (!notification) {
        throw new CodexProviderError('codex_shell_command_stream_closed', 'Codex app-server stream closed before shell command completed', {
          threadId: input.threadId,
          command: input.command,
        })
      }
      if (notification.method === 'item/started') {
        const params = notification.params as ItemNotificationParams | undefined
        const item = params?.item
        if (params?.threadId === input.threadId && isMatchingUserShellCommandItem(item, input.command)) {
          commandItemId = item.id ?? null
        }
        continue
      }
      if (notification.method === 'item/commandExecution/outputDelta') {
        const params = notification.params as CommandExecutionOutputDeltaNotificationParams | undefined
        if (params?.threadId === input.threadId && params.itemId === commandItemId && params.delta) {
          output.append(params.delta)
        }
        continue
      }
      if (notification.method === 'item/completed') {
        const params = notification.params as ItemNotificationParams | undefined
        const item = params?.item
        if (
          params?.threadId === input.threadId
          && item?.type === 'commandExecution'
          && (
            (commandItemId !== null && item.id === commandItemId)
            || isMatchingUserShellCommandItem(item, input.command)
          )
        ) {
          return { item, output: output.read() ?? '' }
        }
      }
    }
  }
  finally {
    clearTimeout(timeout)
    input.signal?.removeEventListener('abort', abort)
  }
}

async function readCodexShellCommandNotification(
  client: CodexAppServerClientLike,
  signal: AbortSignal,
  onAbort: () => void,
): Promise<CodexAppServerMessage | null> {
  try {
    return await client.nextNotification(signal)
  }
  catch (error) {
    if (signal.aborted) {
      onAbort()
    }
    throw error
  }
}

function isMatchingUserShellCommandItem(item: CodexThreadItem | undefined, command: string): item is CodexThreadItem {
  return item?.type === 'commandExecution'
    && typeof item.id === 'string'
    && (item.source === 'userShell' || item.command === command)
}

async function setCodexThreadGoal(
  client: CodexAppServerClientLike,
  runtimeSession: RuntimeSession,
  threadId: string,
  objective: string,
): Promise<CodexGoalSnapshot | null> {
  const response = await client.request('thread/goal/set', {
    threadId,
    objective,
  }) as ThreadGoalGetResponse
  const goalSnapshot = projectCodexGoalSnapshotFromGoal(response.goal ?? null)
  if (!goalSnapshot) {
    return null
  }
  writeCodexGoalSnapshot(runtimeSession, goalSnapshot)
  return readCodexProviderSnapshot(runtimeSession.providerStateSnapshot).codex?.goal ?? null
}

function shouldGenerateCodexThreadTitle(input: {
  isFreshProviderThread: boolean
  existingTitle: string | null
  promptText: string
  goalContinuationRequested: boolean
  compactCommandRequested: boolean
}): boolean {
  return input.isFreshProviderThread
    && !input.existingTitle
    && input.promptText.length > 0
    && !input.goalContinuationRequested
    && !input.compactCommandRequested
}

async function generateAndSetCodexThreadTitle(
  titleClient: CodexAppServerClientLike,
  mainClient: CodexAppServerClientLike,
  input: {
    mainThreadId: string
    promptText: string
    cwd: string
    runtimeWorkspaceRoots: string[]
    modelId: string | null
    fallbackModel: string | null
    thinkingEffort: CodexTitleGenerationThinkingEffort
    config: Record<string, unknown>
    signal: AbortSignal
  },
): Promise<string | null> {
  try {
    return await generateAndSetCodexThreadTitleOrThrow(titleClient, mainClient, input)
  }
  catch {
    return null
  }
}

async function generateAndSetCodexThreadTitleOrThrow(
  titleClient: CodexAppServerClientLike,
  mainClient: CodexAppServerClientLike,
  input: {
    mainThreadId: string
    promptText: string
    cwd: string
    runtimeWorkspaceRoots: string[]
    modelId: string | null
    fallbackModel: string | null
    thinkingEffort: CodexTitleGenerationThinkingEffort
    config: Record<string, unknown>
    signal: AbortSignal
  },
): Promise<string> {
  const title = await generateCodexThreadTitle(titleClient, input)
  if (input.signal.aborted) {
    throw codexRequestError('title/generate', 'Codex title generation was aborted')
  }
  if (!title) {
    throw codexRequestError('title/generate', 'Codex title turn completed without title output')
  }
  try {
    await setCodexThreadTitleName(mainClient, titleClient, {
      threadId: input.mainThreadId,
      name: title,
    })
  }
  catch (error) {
    throw codexRequestError('thread/name/set', formatUnknownError(error))
  }
  return title
}

async function setCodexThreadTitleName(
  primaryClient: CodexAppServerClientLike,
  fallbackClient: CodexAppServerClientLike,
  params: {
    threadId: string
    name: string
  },
): Promise<void> {
  try {
    await primaryClient.request('thread/name/set', params)
  }
  catch {
    await fallbackClient.request('thread/name/set', params)
  }
}

async function generateCodexThreadTitle(
  client: CodexAppServerClientLike,
  input: {
    promptText: string
    cwd: string
    runtimeWorkspaceRoots: string[]
    modelId: string | null
    fallbackModel: string | null
    thinkingEffort: CodexTitleGenerationThinkingEffort
    config: Record<string, unknown>
    signal: AbortSignal
  },
): Promise<string | null> {
  const model = input.modelId ?? input.fallbackModel
  const titleConfig = buildCodexTitleConfig(input.config, model)
  let titleThreadId: string | null = null
  try {
    let threadResponse: ThreadResponse
    try {
      threadResponse = await client.request('thread/start', {
        model,
        cwd: input.cwd,
        runtimeWorkspaceRoots: input.runtimeWorkspaceRoots,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        config: titleConfig,
        ephemeral: true,
        threadSource: 'user',
      }) as ThreadResponse
    }
    catch (error) {
      throw codexRequestError('thread/start', formatUnknownError(error))
    }
    titleThreadId = threadResponse.thread?.id ?? null
    if (!titleThreadId) {
      throw codexRequestError('thread/start', 'Codex title thread did not return a thread id')
    }

    let turnResponse: TurnResponse
    try {
      turnResponse = await client.request('turn/start', {
        threadId: titleThreadId,
        input: buildCodexThreadTitleInput(input.promptText),
        cwd: input.cwd,
        runtimeWorkspaceRoots: input.runtimeWorkspaceRoots,
        approvalPolicy: 'never',
        sandboxPolicy: toSandboxPolicy('read-only', input.runtimeWorkspaceRoots, []),
        model,
        effort: input.thinkingEffort,
      }) as TurnResponse
    }
    catch (error) {
      throw codexRequestError('turn/start', formatUnknownError(error))
    }
    const turnId = turnResponse.turn?.id ?? turnResponse.turnId ?? null
    return await readGeneratedCodexThreadTitle(client, titleThreadId, turnId, input.signal)
  }
  finally {
    if (titleThreadId) {
      await client.request('thread/unsubscribe', { threadId: titleThreadId }).catch(() => undefined)
    }
  }
}

function buildCodexTitleConfig(config: Record<string, unknown>, model: string | null): Record<string, unknown> {
  const titleConfig = { ...config }
  delete titleConfig.instructions_paths
  titleConfig.disable_response_storage = true
  if (model) {
    titleConfig.model = model
  }
  return titleConfig
}

function buildCodexThreadTitleInput(promptText: string): UserInput[] {
  return [{
    type: 'text',
    text: `${CODEX_THREAD_TITLE_PROMPT_PREFIX}\n${promptText}`,
    text_elements: [],
  }]
}

async function readGeneratedCodexThreadTitle(
  client: CodexAppServerClientLike,
  threadId: string,
  turnId: string | null,
  signal: AbortSignal,
): Promise<string | null> {
  const titleAbortController = new AbortController()
  const abortTitleRead = () => titleAbortController.abort()
  signal.addEventListener('abort', abortTitleRead, { once: true })
  const deltas = createBoundedTextCollector()
  let completedText: string | null = null
  try {
    if (signal.aborted) {
      return null
    }
    while (!titleAbortController.signal.aborted) {
      let notification: CodexAppServerMessage | null
      try {
        notification = await client.nextNotification(titleAbortController.signal)
      }
      catch (error) {
        if (titleAbortController.signal.aborted) {
          return null
        }
        throw error
      }
      if (!notification) {
        return null
      }
      const notificationThreadId = getThreadId(notification)
      if (notification.method === 'error' && (!notificationThreadId || notificationThreadId === threadId)) {
        throw codexRequestError('title/notification', readCodexAppServerErrorDetail(notification))
      }
      if (notificationThreadId !== threadId) {
        continue
      }
      const notificationTurnId = getNotificationTurnId(notification)
      if (turnId && notificationTurnId && notificationTurnId !== turnId) {
        continue
      }
      if (notification.method === 'item/agentMessage/delta') {
        const delta = (notification.params as { delta?: string } | undefined)?.delta
        if (delta) {
          deltas.append(delta)
        }
        continue
      }
      if (notification.method === 'item/completed') {
        const item = (notification.params as ItemNotificationParams | undefined)?.item
        if (item?.type === 'agentMessage' && item.text) {
          completedText = item.text
        }
        continue
      }
      if (notification.method === 'turn/completed') {
        return normalizeGeneratedCodexThreadTitle(completedText ?? deltas.read())
      }
    }
    return null
  }
  finally {
    signal.removeEventListener('abort', abortTitleRead)
  }
}

function normalizeGeneratedCodexThreadTitle(title: string | null | undefined): string | null {
  const candidate = readGeneratedCodexThreadTitleCandidate(title)
  const normalized = candidate
    ?.replace(/\s+/g, ' ')
    .trim()
    .replace(/^title\s*:\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[.!?]+$/g, '')
    .trim()
  if (!normalized) {
    return null
  }
  if (normalized.length <= CODEX_THREAD_TITLE_MAX_LENGTH) {
    return normalized
  }
  return normalized.slice(0, CODEX_THREAD_TITLE_MAX_LENGTH).trim().replace(/[.!?]+$/g, '') || null
}

function readCodexAppServerErrorDetail(notification: CodexAppServerMessage): string {
  const params = notification.params
  if (!params || typeof params !== 'object') {
    return 'Codex app-server reported an error'
  }
  const candidate = params as { message?: unknown, error?: unknown, code?: unknown, details?: unknown, additionalDetails?: unknown }
  const nestedError = candidate.error && typeof candidate.error === 'object'
    ? candidate.error as { message?: unknown, details?: unknown, additionalDetails?: unknown }
    : null
  const message = typeof candidate.message === 'string'
    ? candidate.message
    : typeof candidate.error === 'string'
      ? candidate.error
      : typeof nestedError?.message === 'string'
        ? nestedError.message
        : null
  const code = typeof candidate.code === 'string' || typeof candidate.code === 'number'
    ? String(candidate.code)
    : null
  const details = typeof candidate.details === 'string'
    ? candidate.details
    : typeof candidate.additionalDetails === 'string'
      ? candidate.additionalDetails
      : typeof nestedError?.details === 'string'
        ? nestedError.details
        : typeof nestedError?.additionalDetails === 'string'
          ? nestedError.additionalDetails
          : null
  return [code ? `[${code}]` : null, message, details].filter(Boolean).join(' ') || 'Codex app-server reported an error'
}

function readGeneratedCodexThreadTitleCandidate(title: string | null | undefined): string | null {
  const trimmed = title?.trim() ?? ''
  if (!trimmed) {
    return null
  }
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/u, '').trim()
  try {
    const parsed = JSON.parse(unfenced) as { title?: unknown }
    if (typeof parsed.title === 'string') {
      return parsed.title
    }
  }
  catch {
    // Plain-text titles are the expected app-server output.
  }
  return unfenced.split('\n').map(line => line.trim()).find(Boolean) ?? null
}

function isLiveCodexSideFork(runtimeSession: RuntimeSession): boolean {
  if (!runtimeSession.providerSessionId) {
    return false
  }
  const sideConversation = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot).codex?.sideConversation
  return sideConversation?.liveFork === true
    && sideConversation.threadId === runtimeSession.providerSessionId
}

function readLiveSideForkThreadStart(
  runtimeSession: RuntimeSession,
  fallbackModelId?: string | null,
): {
  threadId: string
  title: string | null
  modelId: string | null
  modelProvider: string | null
  serviceTier: string | null
  reasoningEffort: string | null
  status: CodexThreadStatus | null
} {
  if (!runtimeSession.providerSessionId) {
    throw codexRequestError('liveSideFork', 'Codex side conversation is missing a live thread id')
  }
  const snapshot = readCodexProviderSnapshot(runtimeSession.providerStateSnapshot)
  return {
    threadId: runtimeSession.providerSessionId,
    title: null,
    modelId: snapshot.codex?.model?.modelId ?? fallbackModelId ?? snapshot.models?.currentModelId ?? null,
    modelProvider: snapshot.codex?.model?.modelProvider ?? null,
    serviceTier: snapshot.codex?.model?.serviceTier ?? null,
    reasoningEffort: snapshot.codex?.reasoning?.effort ?? null,
    status: snapshot.codex?.status?.status ?? null,
  }
}

async function startOrResumeThread(
  client: CodexAppServerClientLike,
  runtimeSession: RuntimeSession,
  params: {
    model?: string | null
    cwd: string
    runtimeWorkspaceRoots: string[]
    approvalPolicy: CodexConfig['approvalPolicy']
    sandbox: CodexConfig['sandboxMode']
    config: Record<string, unknown>
    requestTimeoutMs?: number
  },
): Promise<{
  threadId: string
  title: string | null
  modelId: string | null
  modelProvider: string | null
  serviceTier: string | null
  reasoningEffort: string | null
  status: CodexThreadStatus | null
}> {
  const baseParams = {
    model: params.model,
    cwd: params.cwd,
    runtimeWorkspaceRoots: params.runtimeWorkspaceRoots,
    approvalPolicy: params.approvalPolicy,
    sandbox: params.sandbox,
    config: params.config,
  }
  const method = runtimeSession.providerSessionId ? 'thread/resume' : 'thread/start'
  const requestParams = runtimeSession.providerSessionId
    ? { ...baseParams, threadId: runtimeSession.providerSessionId, excludeTurns: true }
    : baseParams
  let response: ThreadResponse
  try {
    response = params.requestTimeoutMs
      ? await requestCodexAppServerWithTimeout<ThreadResponse>(client, method, requestParams, params.requestTimeoutMs)
      : await client.request(method, requestParams) as ThreadResponse
  }
  catch (error) {
    throw codexRequestError(method, formatUnknownError(error))
  }
  const threadId = response.thread?.id
  if (!threadId) {
    throw codexRequestError('startOrResumeCodexThread', 'Codex app-server did not return a thread id')
  }
  return {
    threadId,
    title: readCodexThreadDisplayTitle(response.thread),
    modelId: response.model ?? null,
    modelProvider: response.modelProvider ?? response.thread?.modelProvider ?? null,
    serviceTier: response.serviceTier ?? null,
    reasoningEffort: response.reasoningEffort ?? null,
    status: response.thread?.status ?? null,
  }
}

async function injectCradleTranscriptHistory(
  client: CodexAppServerClientLike,
  threadId: string,
  history: UIMessage[] | undefined,
): Promise<void> {
  if (!history?.length) {
    return
  }

  const items = projectCradleTranscriptToCodexItems(history)
  if (items.length === 0) {
    return
  }

  const params: ThreadInjectItemsParams = {
    threadId,
    items: items as ThreadInjectItemsParams['items'],
  }
  await client.request('thread/inject_items', params)
}

async function injectCodexSideBoundary(
  client: CodexAppServerClientLike,
  threadId: string,
): Promise<void> {
  const params: ThreadInjectItemsParams = {
    threadId,
    items: [{
      type: 'message',
      role: 'user',
      content: [{
        type: 'input_text',
        text: CODEX_SIDE_BOUNDARY_PROMPT,
      }],
    }],
  }
  await client.request('thread/inject_items', params)
}

async function injectCodexNativeHistory(
  client: CodexAppServerClientLike,
  threadId: string,
  nativeHistory: CodexNativeHistorySnapshot | undefined,
): Promise<void> {
  if (!nativeHistory?.turns.length) {
    return
  }

  const items = projectCodexNativeTurnsToCodexItems(nativeHistory.turns)
  if (items.length === 0) {
    return
  }

  const params: ThreadInjectItemsParams = {
    threadId,
    items: items as ThreadInjectItemsParams['items'],
  }
  await client.request('thread/inject_items', params)
}

async function hydrateCodexNativeHistory(
  client: CodexAppServerClientLike,
  runtimeSession: RuntimeSession,
  threadId: string,
): Promise<void> {
  try {
    const turns = await listFullCodexTurns(client, threadId)
    writeCodexNativeHistorySnapshot(runtimeSession, {
      threadId,
      itemsView: 'full',
      fetchedAt: Date.now(),
      complete: true,
      turns,
      turnCount: turns.length,
      itemCount: countCodexTurnItems(turns),
      nextCursor: null,
      error: null,
    })
  }
  catch (error) {
    writeCodexNativeHistorySnapshot(runtimeSession, {
      threadId,
      itemsView: 'full',
      fetchedAt: Date.now(),
      complete: false,
      turns: [],
      turnCount: 0,
      itemCount: 0,
      nextCursor: null,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function listFullCodexTurns(
  client: CodexAppServerClientLike,
  threadId: string,
): Promise<Turn[]> {
  const turns: Turn[] = []
  let cursor: string | null = null
  const seenCursors = new Set<string>()
  do {
    const response = await client.request('thread/turns/list', {
      threadId,
      cursor,
      limit: CODEX_THREAD_TURNS_LIST_LIMIT,
      sortDirection: 'asc',
      itemsView: 'full',
    }) as ThreadTurnsListResponse
    turns.push(...(Array.isArray(response.data) ? response.data : []))
    const nextCursor = typeof response.nextCursor === 'string' && response.nextCursor.length > 0
      ? response.nextCursor
      : null
    if (nextCursor && seenCursors.has(nextCursor)) {
      throw codexRequestError('hydrateCodexNativeHistory', `Codex thread/turns/list returned a repeated cursor: ${nextCursor}`)
    }
    if (nextCursor) {
      seenCursors.add(nextCursor)
    }
    cursor = nextCursor
  } while (cursor)
  return turns
}

function countCodexTurnItems(turns: Turn[]): number {
  return turns.reduce((count, turn) => count + turn.items.length, 0)
}

function toCodexThreadSourceKind(kind: ProviderThreadSourceKind): ThreadSourceKind {
  switch (kind) {
    case 'cli':
    case 'vscode':
    case 'exec':
    case 'appServer':
    case 'subAgent':
    case 'subAgentReview':
    case 'subAgentCompact':
    case 'subAgentThreadSpawn':
    case 'subAgentOther':
    case 'unknown':
      return kind
    default:
      return 'unknown'
  }
}

function projectCodexThread(thread: Thread): ProviderThread {
  return {
    id: thread.id,
    providerSessionTreeId: thread.sessionId ?? null,
    forkedFromId: thread.forkedFromId ?? null,
    preview: normalizeProviderTitle(thread.preview) ?? null,
    ephemeral: thread.ephemeral === true,
    modelProvider: normalizeProviderTitle(thread.modelProvider) ?? null,
    createdAt: typeof thread.createdAt === 'number' ? thread.createdAt : null,
    updatedAt: typeof thread.updatedAt === 'number' ? thread.updatedAt : null,
    status: readThreadStatusType(thread.status),
    sourceKind: readCodexThreadSourceKind(thread.source),
    source: thread.source,
    threadSource: thread.threadSource ?? null,
    agentNickname: normalizeProviderTitle(thread.agentNickname) ?? null,
    agentRole: normalizeProviderTitle(thread.agentRole) ?? null,
    name: normalizeProviderTitle(thread.name) ?? null,
    cwd: typeof thread.cwd === 'string' ? thread.cwd : null,
  }
}

function projectCodexTurn(turn: Turn): ProviderThreadTurn {
  return {
    id: turn.id,
    status: turn.status,
    startedAt: turn.startedAt ?? null,
    completedAt: turn.completedAt ?? null,
    durationMs: turn.durationMs ?? null,
    itemsView: turn.itemsView,
    items: turn.items,
  }
}

function projectCodexTurnsToUiMessages(threadId: string, turns: Turn[]): UIMessage[] {
  const messages: UIMessage[] = []
  for (const turn of turns) {
    let assistantParts: UIMessage['parts'] = []
    let assistantMessageIndex = 0
    const flushAssistant = () => {
      if (assistantParts.length === 0) {
        return
      }
      messages.push({
        id: `provider-thread:${threadId}:turn:${turn.id}:assistant:${assistantMessageIndex}`,
        role: 'assistant',
        parts: assistantParts,
      })
      assistantParts = []
      assistantMessageIndex += 1
    }

    for (const item of turn.items) {
      switch (item.type) {
        case 'userMessage':
          flushAssistant()
          messages.push({
            id: `provider-thread:${threadId}:turn:${turn.id}:user:${item.id}`,
            role: 'user',
            parts: projectCodexUserInputsToUiParts(item.content),
          })
          break
        case 'agentMessage':
          if (item.text) {
            assistantParts.push({
              type: 'text',
              text: item.text,
              state: 'done',
            })
          }
          break
        case 'reasoning': {
          const text = [...(item.summary ?? []), ...(item.content ?? [])].join('\n')
          if (text) {
            assistantParts.push({
              type: 'reasoning',
              text,
              state: 'done',
            })
          }
          break
        }
        case 'hookPrompt':
          break
        default:
          assistantParts.push(projectCodexToolItemToUiPart(item as CodexAppServerItem))
          break
      }
    }
    flushAssistant()
  }
  return messages
}

function projectCodexUserInputsToUiParts(inputs: UserInput[]): UIMessage['parts'] {
  const parts: UIMessage['parts'] = []
  for (const input of inputs) {
    switch (input.type) {
      case 'text':
        parts.push({ type: 'text', text: input.text, state: 'done' })
        break
      case 'image':
        parts.push({ type: 'file', mediaType: 'image/*', url: input.url })
        break
      case 'localImage':
        parts.push({ type: 'file', mediaType: 'image/*', url: `file://${input.path}` })
        break
      case 'skill':
      case 'mention':
        parts.push({ type: 'text', text: `@${input.name}`, state: 'done' })
        break
    }
  }
  return parts.length > 0 ? parts : [{ type: 'text', text: '', state: 'done' }]
}

function projectCodexToolItemToUiPart(item: CodexAppServerItem): UIMessage['parts'][number] {
  const errorText = readCodexToolError(item)
  const toolName = readCodexToolName(item)
  const input = buildCodexToolInput(item)
  if (errorText) {
    return {
      type: 'dynamic-tool',
      toolCallId: item.id,
      toolName,
      state: 'output-error',
      input,
      errorText,
    }
  }
  return {
    type: 'dynamic-tool',
    toolCallId: item.id,
    toolName,
    state: 'output-available',
    input,
    output: buildCodexToolOutput(item),
  }
}

function readThreadStatusType(status: Thread['status']): string {
  return typeof status === 'object' && status !== null && 'type' in status
    ? String(status.type)
    : 'unknown'
}

function readCodexThreadSourceKind(source: Thread['source']): ProviderThreadSourceKind {
  if (typeof source === 'string') {
    switch (source) {
      case 'cli':
      case 'vscode':
      case 'exec':
      case 'appServer':
      case 'unknown':
        return source
      default:
        return 'unknown'
    }
  }
  if (!source || typeof source !== 'object' || !('subAgent' in source)) {
    return 'unknown'
  }
  const subAgentSource = source.subAgent
  if (subAgentSource === 'review') {
    return 'subAgentReview'
  }
  if (subAgentSource === 'compact') {
    return 'subAgentCompact'
  }
  if (subAgentSource && typeof subAgentSource === 'object') {
    if ('thread_spawn' in subAgentSource) {
      return 'subAgentThreadSpawn'
    }
    if ('other' in subAgentSource) {
      return 'subAgentOther'
    }
  }
  return 'subAgent'
}

async function assertCodexThreadBelongsToRuntimeSession(
  client: CodexAppServerClientLike,
  parentThreadId: string | null,
  thread: Thread,
): Promise<void> {
  if (!parentThreadId) {
    throw codexRequestError('thread/read', 'Cannot read provider thread before the parent runtime thread exists')
  }
  const parent = await client.request('thread/read', {
    threadId: parentThreadId,
    includeTurns: false,
  }) as ThreadReadResponse
  if (!codexThreadBelongsToRuntimeParent(parent.thread, thread)) {
    throw codexRequestError('thread/read', `Provider thread ${thread.id} does not belong to runtime thread ${parentThreadId}`)
  }
}

function codexThreadBelongsToRuntimeParent(parentThread: Thread, thread: Thread): boolean {
  if (parentThread.sessionId && thread.sessionId === parentThread.sessionId) {
    return true
  }
  if (thread.forkedFromId === parentThread.id) {
    return true
  }
  return readCodexThreadSpawnParentThreadId(thread.source) === parentThread.id
}

function readCodexThreadSpawnParentThreadId(source: Thread['source']): string | null {
  if (!source || typeof source !== 'object' || !('subAgent' in source)) {
    return null
  }
  const subAgentSource = source.subAgent
  if (!subAgentSource || typeof subAgentSource !== 'object' || !('thread_spawn' in subAgentSource)) {
    return null
  }
  const spawn = subAgentSource.thread_spawn
  if (!spawn || typeof spawn !== 'object') {
    return null
  }
  const parentThreadId = (spawn as { parent_thread_id?: unknown }).parent_thread_id
  return typeof parentThreadId === 'string' && parentThreadId.length > 0 ? parentThreadId : null
}

function buildCodexConfig(
  config: CodexConfig,
  _workspacePath: string,
  _resolveSkillPaths: (workspacePath: string) => string[],
  systemPromptFile: string | null,
  effectiveModel?: string | null,
): NonNullable<ThreadForkParams['config']> {
  const codexConfig: NonNullable<ThreadForkParams['config']> = {
    network_access: 'enabled',
    show_raw_agent_reasoning: true,
    disable_response_storage: true,
  }
  const mcpServers = buildCodexMcpServersConfig()
  codexConfig.approval_policy = config.approvalPolicy
  codexConfig.sandbox_mode = config.sandboxMode
  if (Object.keys(mcpServers).length > 0) {
    codexConfig.mcp_servers = mcpServers
  }
  if (systemPromptFile) {
    codexConfig.instructions_paths = [systemPromptFile]
  }
  if (config.baseUrl) {
    codexConfig.model_provider = CRADLE_CODEX_MODEL_PROVIDER
    codexConfig.model_providers = {
      [CRADLE_CODEX_MODEL_PROVIDER]: {
        name: 'Cradle OpenAI Compatible',
        base_url: config.baseUrl,
        env_key: CRADLE_CODEX_API_KEY_ENV,
        wire_api: 'responses',
        requires_openai_auth: true,
      },
    }
  }
  if (effectiveModel) {
    codexConfig.model = effectiveModel
  }
  return codexConfig
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

function writeSystemPromptFile(systemPrompt: string | undefined): string | null {
  if (!systemPrompt) {
    return null
  }
  const filePath = join(tmpdir(), `cradle-codex-prompt-${randomUUID()}.md`)
  writeFileSync(filePath, systemPrompt, 'utf-8')
  return filePath
}

function syncCodexProviderNativeAppServerSnapshot(
  input: ProviderNativeAppServerInvokeInput,
  result: unknown,
): void {
  if (input.method === 'thread/goal/clear') {
    clearCodexGoalSnapshot(input.runtimeSession)
    return
  }

  if (input.method !== 'thread/goal/set') {
    return
  }

  const response = readUnknownRecord(result) as ThreadGoalGetResponse
  const goalSnapshot = projectCodexGoalSnapshotFromGoal(response.goal ?? null)
  if (goalSnapshot) {
    writeCodexGoalSnapshot(input.runtimeSession, goalSnapshot)
  }
}

function readUnknownRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function projectCodexRuntimeAccessMode(
  accessMode: ChatRuntimeAccessMode,
  input: {
    writableRoots: string[]
    additionalDirectories: string[]
  },
): {
  approvalPolicy: CodexConfig['approvalPolicy']
  sandbox: CodexConfig['sandboxMode']
  sandboxPolicy: SandboxPolicy
} {
  if (accessMode === 'approval-required') {
    return {
      approvalPolicy: 'untrusted',
      sandbox: 'read-only',
      sandboxPolicy: toSandboxPolicy('read-only', input.writableRoots, input.additionalDirectories),
    }
  }
  return {
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
    sandboxPolicy: toSandboxPolicy('danger-full-access', input.writableRoots, input.additionalDirectories),
  }
}

function buildCodexCollaborationMode(
  settings: ChatRuntimeSettings,
  input: { model: string | null, effort: ReasoningEffort },
): CollaborationMode {
  return {
    mode: settings.interactionMode,
    settings: {
      model: input.model ?? '',
      reasoning_effort: input.effort,
      developer_instructions: null,
    },
  }
}

function toSandboxPolicy(
  sandboxMode: CodexConfig['sandboxMode'],
  writableRoots: string[],
  additionalDirectories: string[],
): SandboxPolicy {
  if (sandboxMode === 'danger-full-access') {
    return { type: 'dangerFullAccess' }
  }
  if (sandboxMode === 'read-only') {
    return { type: 'readOnly', networkAccess: false }
  }
  return {
    type: 'workspaceWrite',
    writableRoots: [...new Set([...writableRoots, ...additionalDirectories])],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  }
}
