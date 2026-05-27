import { randomUUID } from 'node:crypto'

import type { Options, Query, SDKUserMessage, SlashCommand } from '@anthropic-ai/claude-agent-sdk'
import type { LangfuseGeneration } from '@langfuse/tracing'
import { startObservation } from '@langfuse/tracing'
import type { UIMessage, UIMessageChunk } from 'ai'

import { langfuseEnabled } from '../../../../langfuse'
import { getRegisteredMcpServers } from '../../../../plugins'
import { readTrustedClaudeAgentConfig, resolveApiKey } from '../../../providers/provider-base'
import type { RuntimeKind } from '../../../providers/types'
import type { TokenUsage } from '../../engine/ai-sdk-engine'
import type {
  CancelTurnInput,
  ChatRuntime,
  ChatRuntimeCapabilities,
  GetCapabilitiesInput,
  ResumeChatSessionInput,
  RuntimeSession,
  RuntimeSlashCommand,
  StartChatSessionInput,
  SteerTurnInput,
  StreamTurnInput,
} from '../../runtime-provider-types'
import { recordChatStreamTrace } from '../../stream-trace'
import { readWorkspaceProviderStateSnapshot } from '../provider-state-snapshot'
import type { ClaudeAgentChunkMapperState } from './mapper'
import { mapClaudeAgentMessageToChunks } from './mapper'

interface ClaudeAgentProviderDeps {
  readSecret: (credentialRef: string) => string
  resolveSkillPaths?: (workspacePath: string) => string[]
}

const RUNTIME_KIND: RuntimeKind = 'claude-agent'
type ActiveClaudeQuery = {
  query: Query
  abortController: AbortController
  inputStream: ClaudeAgentInputStream
}
type RuntimeMessageInput = UIMessage | string
type MessagePart = UIMessage['parts'][number]
type ClaudeAgentUserContent = SDKUserMessage['message']['content']
type AnthropicImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
type ClaudeAgentContentBlock
  = | { type: 'text', text: string }
    | {
    type: 'image'
    source:
      | { type: 'base64', media_type: AnthropicImageMediaType, data: string }
      | { type: 'url', url: string }
  }

export class ClaudeAgentProvider implements ChatRuntime {
  readonly runtimeKind = RUNTIME_KIND

  private readonly activeQueries = new Map<string, ActiveClaudeQuery>()
  private _lastUsage: TokenUsage | null = null

  get lastUsage(): TokenUsage | null {
    return this._lastUsage
  }

  constructor(private readonly deps: ClaudeAgentProviderDeps) {}

  private releaseQuery(sessionId: string, entry: ActiveClaudeQuery): void {
    if (this.activeQueries.get(sessionId) === entry) {
      this.activeQueries.delete(sessionId)
    }
  }

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: input.profile.providerTargetId,
      runtimeKind: RUNTIME_KIND,
      providerSessionId: null,
      providerStateSnapshot: JSON.stringify({
        workspacePath: input.workspacePath,
        models: { currentModelId: input.modelId },
      }),
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    return {
      ...input.runtimeSession,
      providerStateSnapshot: JSON.stringify({
        ...snapshot,
        workspacePath: input.workspacePath,
        models: {
          currentModelId: input.modelId ?? snapshot.models.currentModelId,
        },
      }),
    }
  }

  async getCapabilities(input: GetCapabilitiesInput): Promise<ChatRuntimeCapabilities> {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const abortController = new AbortController()
    const queryOptions = buildClaudeQueryOptions({
      deps: this.deps,
      input,
      abortController,
      attachPermissionHandler: false,
    })
    const activeQuery = query({ prompt: emptyUserInput(), options: queryOptions })

    try {
      const slashCommands = await activeQuery.supportedCommands()

      return {
        runtimeKind: RUNTIME_KIND,
        slashCommands: slashCommands.map(toRuntimeSlashCommand),
        skills: [],
      }
    }
    finally {
      activeQuery.close()
    }
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')

    const abortController = new AbortController()
    const projectedUserContent = projectClaudeAgentInput(input.message, 'Claude Agent provider')
    const userContent = buildClaudeAgentTurnContent({
      userContent: projectedUserContent,
      history: input.runtimeSession.providerSessionId ? undefined : input.history,
    })
    const userPromptText = describeClaudeAgentUserContent(userContent)
    const textItemId = randomUUID()
    const config = readTrustedClaudeAgentConfig(input.profile.configJson)
    const effectiveModel = readClaudeAgentModelId(input, config)
    const queryOptions = buildClaudeQueryOptions({
      deps: this.deps,
      input,
      abortController,
      attachPermissionHandler: true,
    })

    const inputStream = new ClaudeAgentInputStream()
    const activeQuery = query({ prompt: inputStream, options: queryOptions })
    const sessionId = input.runtimeSession.chatSessionId
    const activeEntry: ActiveClaudeQuery = { query: activeQuery, abortController, inputStream }
    this.activeQueries.set(sessionId, activeEntry)
    this._lastUsage = null
    const traceMessageId = input.responseMessageId ?? input.message.id

    const mapperState: ClaudeAgentChunkMapperState = {
      textItemId,
      assistantStarted: false,
      hadToolCallSinceLastText: false,
      emittedTextByTextItemId: new Map(),
      emittedToolStateByToolCallId: new Map(),
      activeToolBlockIds: new Map(),
      subagentStreams: new Map(),
    }

    // Langfuse tracing via @langfuse/tracing SDK
    let generation: LangfuseGeneration | null = null
    if (langfuseEnabled) {
      generation = startObservation('claude-agent-generation', {
        model: effectiveModel,
        input: input.systemPrompt
          ? [{ role: 'system', content: input.systemPrompt }, { role: 'user', content: userPromptText }]
          : [{ role: 'user', content: userPromptText }],
      }, { asType: 'generation' }) as LangfuseGeneration
      // Set trace-level attributes for session grouping
      const span = generation.otelSpan
      span.setAttribute('langfuse.session.id', input.runtimeSession.chatSessionId)
      span.setAttribute('langfuse.trace.name', 'claude-agent-chat')
    }
    let outputTextCollector = ''

    try {
      // Always pin the model on resumed sessions. input.modelId may be undefined
      // when the frontend relies on the snapshot's currentModelId, but we still
      // need to call setModel so the SDK doesn't fall back to env vars.
      if (input.runtimeSession.providerSessionId && effectiveModel) {
        await activeQuery.setModel(effectiveModel)
      }
      inputStream.push(userContent)

      for await (const message of activeQuery) {
        if (abortController.signal.aborted) {
          break
        }

        recordChatStreamTrace({
          chatSessionId: input.runtimeSession.chatSessionId,
          runId: input.runId,
          messageId: traceMessageId,
          runtimeKind: this.runtimeKind,
          providerSessionId: input.runtimeSession.providerSessionId,
          phase: 'provider_raw',
          payload: message,
        })

        const result = await mapClaudeAgentMessageToChunks(message, mapperState)
        mapperState.assistantStarted = result.assistantStarted

        recordChatStreamTrace({
          chatSessionId: input.runtimeSession.chatSessionId,
          runId: input.runId,
          messageId: traceMessageId,
          runtimeKind: this.runtimeKind,
          providerSessionId: result.sessionId ?? input.runtimeSession.providerSessionId,
          phase: 'mapper_output',
          payload: {
            messageType: message.type,
            chunks: result.chunks,
            sessionId: result.sessionId ?? null,
            usage: result.usage ?? null,
            assistantStarted: result.assistantStarted,
          },
        })

        for (const chunk of result.chunks) {
          // Collect text output for Langfuse
          if (generation && chunk.type === 'text-delta' && 'delta' in chunk) {
            outputTextCollector += (chunk as { delta: string }).delta
          }
          yield chunk
        }

        if (result.sessionId && result.sessionId !== input.runtimeSession.providerSessionId) {
          input.runtimeSession.providerSessionId = result.sessionId
        }

        if (result.usage) {
          this._lastUsage = result.usage
        }

        if (message.type === 'result') {
          inputStream.close()
        }
      }

      if (mapperState.assistantStarted) {
        yield { type: 'text-end', id: mapperState.textItemId }
      }

      // Record usage and output in the generation
      if (generation) {
        generation.update({
          output: outputTextCollector || undefined,
          ...(this._lastUsage && {
            usageDetails: {
              input: this._lastUsage.promptTokens,
              output: this._lastUsage.completionTokens,
              total: this._lastUsage.totalTokens,
            },
          }),
        })
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
      inputStream.close()
      this.releaseQuery(sessionId, activeEntry)
    }
  }

  async steerTurn(input: SteerTurnInput): Promise<void> {
    const sessionId = input.runtimeSession.chatSessionId
    const entry = this.activeQueries.get(sessionId)
    if (!entry) {
      throw new Error('Claude Agent query is not active')
    }

    const userContent = projectClaudeAgentInput(input.message, 'Claude Agent steer')
    await entry.query.interrupt()
    entry.inputStream.push(userContent)
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const sessionId = input.runtimeSession.chatSessionId
    const entry = this.activeQueries.get(sessionId)
    if (!entry) {
      return
    }
    entry.abortController.abort()
    entry.query.close()
    entry.inputStream.close()
    this.releaseQuery(sessionId, entry)
  }
}

class ClaudeAgentInputStream implements AsyncIterable<SDKUserMessage> {
  private readonly messages: SDKUserMessage[] = []
  private readonly waiters: Array<() => void> = []
  private closed = false

  constructor(initialContent?: ClaudeAgentUserContent) {
    if (initialContent !== undefined) {
      this.push(initialContent)
    }
  }

  push(content: ClaudeAgentUserContent): void {
    this.messages.push({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      priority: 'now',
    })
    this.wakeNextWaiter()
  }

  close(): void {
    this.closed = true
    this.wakeAllWaiters()
  }

  async* [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (true) {
      const next = this.messages.shift()
      if (next) {
        yield next
        continue
      }
      if (this.closed) {
        return
      }
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve)
      })
    }
  }

  private wakeNextWaiter(): void {
    const waiter = this.waiters.shift()
    waiter?.()
  }

  private wakeAllWaiters(): void {
    while (this.waiters.length > 0) {
      this.wakeNextWaiter()
    }
  }
}

function projectClaudeAgentInput(message: RuntimeMessageInput, runtimeLabel: string): ClaudeAgentUserContent {
  if (typeof message === 'string') {
    const text = message.trim()
    if (!text) {
      throw new Error(`${runtimeLabel} requires non-empty text or image input`)
    }
    return text
  }

  const blocks: ClaudeAgentContentBlock[] = []
  const unsupportedParts: string[] = []
  for (const part of message.parts) {
    if (part.type === 'text') {
      const text = part.text.trim()
      if (text) {
        blocks.push({ type: 'text', text })
      }
      continue
    }
    if (part.type === 'file') {
      if (part.mediaType.startsWith('image/')) {
        blocks.push(toClaudeAgentImageBlock(part, runtimeLabel))
      }
      else {
        unsupportedParts.push(describeUnsupportedFilePart(part))
      }
      continue
    }
    unsupportedParts.push(part.type)
  }

  if (unsupportedParts.length > 0) {
    throw new Error(`${runtimeLabel} only supports text and image input; unsupported parts: ${unsupportedParts.join(', ')}`)
  }
  if (blocks.length === 0) {
    throw new Error(`${runtimeLabel} requires non-empty text or image input`)
  }
  if (blocks.length === 1 && blocks[0]?.type === 'text') {
    return blocks[0].text
  }
  return blocks
}

function buildClaudeAgentTurnContent(input: {
  userContent: ClaudeAgentUserContent
  history?: UIMessage[]
}): ClaudeAgentUserContent {
  const historyText = formatClaudeAgentHistory(input.history)
  if (!historyText) {
    return input.userContent
  }

  const prefix = [
    'Previous messages in this Cradle chat session:',
    historyText,
    '',
    'Current user message:',
  ].join('\n')

  if (typeof input.userContent === 'string') {
    return `${prefix}\n${input.userContent}`
  }

  return [
    { type: 'text', text: prefix },
    ...input.userContent,
  ]
}

function formatClaudeAgentHistory(history: UIMessage[] | undefined): string | null {
  const entries = history
    ?.map(formatClaudeAgentHistoryMessage)
    .filter((entry): entry is string => Boolean(entry))
    ?? []
  return entries.length > 0 ? entries.join('\n\n') : null
}

function formatClaudeAgentHistoryMessage(message: UIMessage): string | null {
  const textParts = message.parts
    .flatMap((part) => {
      if (part.type === 'text') {
        return part.text.trim()
      }
      return []
    })
    .filter(Boolean)
  if (textParts.length === 0) {
    return null
  }

  const role = message.role === 'assistant' ? 'Assistant' : message.role === 'user' ? 'User' : 'System'
  return `${role}: ${textParts.join('\n')}`
}

function toClaudeAgentImageBlock(part: Extract<MessagePart, { type: 'file' }>, runtimeLabel: string): ClaudeAgentContentBlock {
  const mediaType = toAnthropicImageMediaType(part.mediaType)
  if (!mediaType) {
    throw new Error(`${runtimeLabel} only supports jpeg, png, gif, and webp image input; unsupported file: ${describeUnsupportedFilePart(part)}`)
  }

  const dataUrl = parseDataUrl(part.url)
  if (dataUrl) {
    if (dataUrl.mediaType && dataUrl.mediaType !== mediaType) {
      throw new Error(`${runtimeLabel} image media type mismatch for ${describeFilePart(part)}: declared ${mediaType}, url ${dataUrl.mediaType}`)
    }
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: dataUrl.data,
      },
    }
  }

  if (isHttpUrl(part.url)) {
    return {
      type: 'image',
      source: {
        type: 'url',
        url: part.url,
      },
    }
  }

  throw new Error(`${runtimeLabel} image input requires a data URL or http(s) URL; unsupported file: ${describeUnsupportedFilePart(part)}`)
}

function toAnthropicImageMediaType(mediaType: string): AnthropicImageMediaType | null {
  switch (mediaType) {
    case 'image/jpeg':
    case 'image/png':
    case 'image/gif':
    case 'image/webp':
      return mediaType
    default:
      return null
  }
}

function parseDataUrl(url: string): { mediaType: string | null, data: string } | null {
  const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/i.exec(url)
  if (!match) {
    return null
  }
  return {
    mediaType: match[1]?.toLowerCase() ?? null,
    data: match[2] ?? '',
  }
}

function isHttpUrl(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('http://')
}

function describeUnsupportedFilePart(part: Extract<MessagePart, { type: 'file' }>): string {
  return `${describeFilePart(part)} (${part.mediaType})`
}

function describeFilePart(part: Extract<MessagePart, { type: 'file' }>): string {
  const filename = part.filename ? ` (${part.filename})` : ''
  return `file${filename}`
}

function describeClaudeAgentUserContent(content: ClaudeAgentUserContent): string {
  if (typeof content === 'string') {
    return content
  }
  const text = content
    .filter((block): block is Extract<ClaudeAgentContentBlock, { type: 'text' }> => isClaudeTextBlock(block))
    .map(block => block.text)
    .join('\n')
    .trim()
  const imageCount = content.filter(isClaudeImageBlock).length
  if (imageCount === 0) {
    return text
  }
  const suffix = `[${imageCount} image${imageCount === 1 ? '' : 's'}]`
  return text ? `${text}\n${suffix}` : suffix
}

function isClaudeTextBlock(block: unknown): block is Extract<ClaudeAgentContentBlock, { type: 'text' }> {
  return Boolean(block) && typeof block === 'object' && (block as { type?: unknown }).type === 'text'
}

function isClaudeImageBlock(block: unknown): block is Extract<ClaudeAgentContentBlock, { type: 'image' }> {
  return Boolean(block) && typeof block === 'object' && (block as { type?: unknown }).type === 'image'
}

function buildClaudeQueryOptions(input: {
  deps: ClaudeAgentProviderDeps
  input: StreamTurnInput | GetCapabilitiesInput
  abortController: AbortController
  attachPermissionHandler: boolean
}): Options {
  const config = readTrustedClaudeAgentConfig(input.input.profile.configJson)
  const apiKey = resolveApiKey(input.input.profile, config.apiKey, 'ANTHROPIC_API_KEY', input.deps)
  const effectiveModel = readClaudeAgentModelId(input.input, config)

  if (!apiKey) {
    throw new Error('Claude Agent provider requires an API key')
  }

  const snapshot = readWorkspaceProviderStateSnapshot(input.input.runtimeSession.providerStateSnapshot)
  const queryOptions: Options = {
    abortController: input.abortController,
    cwd: snapshot.workspacePath ?? input.input.workspacePath ?? process.cwd(),
    permissionMode: config.permissionMode,
    allowDangerouslySkipPermissions: config.permissionMode === 'bypassPermissions'
      ? true
      : config.allowDangerouslySkipPermissions,
    maxTurns: config.maxTurns,
    additionalDirectories: config.additionalDirectories,
    includePartialMessages: true,
    forwardSubagentText: true,
    agentProgressSummaries: true,
    systemPrompt: input.input.systemPrompt
      ? { type: 'preset' as const, preset: 'claude_code' as const, append: input.input.systemPrompt }
      : undefined,
    // Native Claude SDK support: discover and invoke all SDK-visible skills/commands.
    // Cradle-specific skill projection is intentionally out of scope for this pass.
    skills: 'all',
  }
  if (config.tools) {
    queryOptions.tools = config.tools
  }
  if (config.disallowedTools) {
    queryOptions.disallowedTools = config.disallowedTools
  }
  if (input.input.runtimeSession.providerSessionId) {
    queryOptions.resume = input.input.runtimeSession.providerSessionId
  }
  // Always set the model — even for resumed sessions. Without this, the SDK
  // subprocess falls back to ANTHROPIC_MODEL from the environment, silently
  // using a different model than the provider target resolved.
  if (effectiveModel) {
    queryOptions.model = effectiveModel
  }

  const registeredServers = getRegisteredMcpServers()
  if (Object.keys(registeredServers).length > 0) {
    queryOptions.mcpServers = { ...queryOptions.mcpServers, ...registeredServers }
  }

  // Prevent the SDK subprocess from reading ~/.claude/settings.json or
  // .claude/settings.json which could inject ANTHROPIC_MODEL or alias overrides
  // that conflict with the provider target Cradle resolved.
  queryOptions.settingSources = []

  // Forward the full host environment so Agent bash commands have the user's
  // shell setup (PATH, NVM_DIR, GOPATH, JAVA_HOME, etc.), but explicitly
  // strip model-related vars that would silently override the provider target.
  const env: Record<string, string | undefined> = { ...process.env }
  for (const key of [
    'ANTHROPIC_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'CLAUDE_CODE_SUBAGENT_MODEL',
  ]) {
    delete env[key]
  }
  env.ANTHROPIC_API_KEY = apiKey
  if (config.baseUrl) {
    env.ANTHROPIC_BASE_URL = config.baseUrl
  }
  env.CRADLE_CHAT_SESSION_ID = input.input.runtimeSession.chatSessionId
  env.CRADLE_WORKSPACE_ID = input.input.workspaceId ?? undefined
  Object.assign(env, buildClaudeAgentModelEnv(config.claudeAgent))
  queryOptions.env = env

  return queryOptions
}

function readClaudeAgentModelId(
  input: Pick<StreamTurnInput | GetCapabilitiesInput, 'modelId' | 'runtimeSession'>,
  config: ReturnType<typeof readTrustedClaudeAgentConfig>,
): string | undefined {
  const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
  return input.modelId ?? snapshot.models.currentModelId ?? config.model
}

function buildClaudeAgentModelEnv(config: {
  modelAliases?: {
    haiku?: string
    sonnet?: string
    opus?: string
  }
  subagentModel?: string
} | undefined): Record<string, string> {
  const env: Record<string, string> = {}
  const aliases = config?.modelAliases
  const haiku = readNonEmptyEnvValue(aliases?.haiku)
  const sonnet = readNonEmptyEnvValue(aliases?.sonnet)
  const opus = readNonEmptyEnvValue(aliases?.opus)
  const subagentModel = readNonEmptyEnvValue(config?.subagentModel)

  if (haiku) {
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = haiku
  }
  if (sonnet) {
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnet
  }
  if (opus) {
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = opus
  }
  if (subagentModel) {
    env.CLAUDE_CODE_SUBAGENT_MODEL = subagentModel
  }

  return env
}

function readNonEmptyEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

async function* emptyUserInput(): AsyncGenerator<SDKUserMessage, void, void> {}

function toRuntimeSlashCommand(command: SlashCommand): RuntimeSlashCommand {
  return {
    name: command.name,
    description: command.description,
    argumentHint: command.argumentHint,
    aliases: command.aliases,
  }
}
