/**
 * Output: Claude Agent SDK user content and query options projected from Chat Runtime input.
 * Input: Cradle UIMessage turns, history, provider target config, workspace snapshot, and ProviderContext.
 * Position: Claude Agent provider package boundary from Cradle runtime contracts to SDK-native input.
 */

import type { McpServerConfig, Options } from '@anthropic-ai/claude-agent-sdk'
import type { UIMessage } from 'ai'

import { readObjectRecord as readRecord } from '../../../helpers/json-record'
import { getRegisteredMcpServers } from '../../../plugins/mcp-registry'
import { isChatSkillContextPart, readChatPluginContextPart, readChatSkillContextPart } from '../../chat-runtime/context-parts'
import type {
  ChatRuntimeSettings,
  GetCapabilitiesInput,
  ProviderContext,
  RuntimeProviderTargetProfile,
  StreamTurnInput,
} from '../../chat-runtime/runtime-provider-types'
import { ProviderErrors, ProviderRuntimeError } from '../../chat-runtime/runtime-provider-types'
import {
  readTrustedClaudeAgentConfig,
  readTrustedUniversalConfig,
  resolveApiKey,
} from '../../provider-contracts/provider-base'
import { readWorkspaceProviderStateSnapshot } from '../provider-state-snapshot'
import { CLAUDE_AGENT_RUNTIME_KIND } from './metadata'
import { activateClaudeAgentSdkConfigDir, resolveClaudeAgentRuntimeContext } from './runtime-context'
import type {
  AnthropicImageMediaType,
  ClaudeAgentContentBlock,
  ClaudeAgentUserContent,
  MessagePart,
  RuntimeMessageInput,
} from './types'

export const CLAUDE_AGENT_SDK_PERSIST_SESSION = true

export function projectClaudeAgentInput(message: RuntimeMessageInput, runtimeLabel: string): ClaudeAgentUserContent {
  if (typeof message === 'string') {
    const text = message.trim()
    if (!text) {
      throw claudeAgentRequestError('projectInput', `${runtimeLabel} requires non-empty text or image input`)
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
    if (isChatSkillContextPart(part)) {
      continue
    }
    const pluginPart = readChatPluginContextPart(part)
    if (pluginPart) {
      blocks.push({ type: 'text', text: describePluginMentionForText(pluginPart) })
      continue
    }
    unsupportedParts.push(part.type)
  }

  if (unsupportedParts.length > 0) {
    throw claudeAgentRequestError('projectInput', `${runtimeLabel} only supports text, image, skill, and plugin mention input; unsupported parts: ${unsupportedParts.join(', ')}`)
  }
  if (blocks.length === 0) {
    throw claudeAgentRequestError('projectInput', `${runtimeLabel} requires non-empty text or image input`)
  }
  if (blocks.length === 1 && blocks[0]?.type === 'text') {
    return blocks[0].text
  }
  return blocks
}

function describePluginMentionForText(plugin: NonNullable<ReturnType<typeof readChatPluginContextPart>>): string {
  const capabilities = plugin.capabilities.map(capability => `${capability.type}:${capability.layer}`).join(', ')
  const mcpServers = plugin.mcpServers.length > 0 ? ` MCP servers: ${plugin.mcpServers.join(', ')}.` : ''
  const description = plugin.description ? ` ${plugin.description}` : ''
  return `Selected Cradle plugin @${plugin.displayName}.${description}${capabilities ? ` Capabilities: ${capabilities}.` : ''}${mcpServers}`
}

export function buildClaudeAgentTurnContent(input: {
  userContent: ClaudeAgentUserContent
  history?: UIMessage[]
  historyScope?: 'full' | 'recentCradleLocal'
}): ClaudeAgentUserContent {
  const historyText = formatClaudeAgentHistory(input.history, input.historyScope ?? 'full')
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

export function describeClaudeAgentUserContent(content: ClaudeAgentUserContent): string {
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

export function buildClaudeQueryOptions(input: {
  deps: ProviderContext
  input: StreamTurnInput | GetCapabilitiesInput
  abortController: AbortController
  attachPermissionHandler: boolean
  persistSession?: boolean
}): Options {
  const config = readTrustedClaudeAgentConfig(input.input.profile.configJson)
  const apiKey = resolveApiKey(input.input.profile, config.apiKey, 'ANTHROPIC_API_KEY', input.deps)
  const effectiveModel = readClaudeAgentModelId(input.input, config)
  const providerOptions = 'providerOptions' in input.input ? input.input.providerOptions : undefined
  const permissionMode = (providerOptions
    ? projectRuntimeSettingsToClaudePermissionMode(providerOptions.runtimeSettings)
    : undefined) ?? config.permissionMode

  if (!apiKey) {
    throw new ProviderRuntimeError(ProviderErrors.authFailed(CLAUDE_AGENT_RUNTIME_KIND))
  }

  const snapshot = readWorkspaceProviderStateSnapshot(input.input.runtimeSession.providerStateSnapshot)
  const runtimeContext = resolveClaudeAgentRuntimeContext(
    snapshot.workspacePath ?? input.input.workspacePath,
    input.input.agentId ?? snapshot.agentId ?? null,
  )
  const shouldPersistSession = input.persistSession ?? CLAUDE_AGENT_SDK_PERSIST_SESSION
  const queryOptions: Options = {
    abortController: input.abortController,
    cwd: runtimeContext.cwd,
    permissionMode,
    allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions'
      ? true
      : config.allowDangerouslySkipPermissions,
    maxTurns: config.maxTurns,
    additionalDirectories: uniquePaths([
      ...runtimeContext.additionalDirectories,
      ...config.additionalDirectories,
    ]),
    includePartialMessages: true,
    forwardSubagentText: true,
    agentProgressSummaries: true,
    effort: readClaudeAgentEffort(providerOptions?.thinkingEffort, config.effort),
    persistSession: shouldPersistSession,
    systemPrompt: input.input.systemPrompt
      ? { type: 'preset' as const, preset: 'claude_code' as const, append: input.input.systemPrompt }
      : undefined,
  }
  if (config.skills === 'all' || (Array.isArray(config.skills) && config.skills.length > 0)) {
    queryOptions.skills = config.skills
  }
  if ('message' in input.input && input.input.message) {
    const selectedSkills = readSelectedSkillNames(input.input.message)
    if (selectedSkills.length > 0 && queryOptions.skills !== 'all') {
      const configuredSkills = Array.isArray(queryOptions.skills) ? queryOptions.skills : []
      queryOptions.skills = [...new Set([...configuredSkills, ...selectedSkills])]
    }
  }
  if (config.tools) {
    queryOptions.tools = config.tools
  }
  const disallowedTools = config.disallowedTools ?? []
  queryOptions.disallowedTools = [...new Set(disallowedTools)]
  if (input.attachPermissionHandler && permissionMode === 'plan') {
    queryOptions.canUseTool = async (toolName) => {
      if (toolName === 'ExitPlanMode') {
        return {
          behavior: 'deny',
          message: 'Cradle captured the proposed plan. Stop here and wait for the user to refine or implement it in a later turn.',
        }
      }

      return {
        behavior: 'deny',
        message: 'Cradle plan mode is active. Do not execute tools in this turn; provide the plan through ExitPlanMode.',
      }
    }
  }
  if (shouldPersistSession && input.input.runtimeSession.providerSessionId) {
    queryOptions.resume = input.input.runtimeSession.providerSessionId
  }
  // Always set the model because the SDK subprocess otherwise falls back to model env vars.
  if (effectiveModel) {
    queryOptions.model = effectiveModel
  }

  const registeredServers = getRegisteredMcpServers()
  if (Object.keys(registeredServers).length > 0) {
    queryOptions.mcpServers = { ...queryOptions.mcpServers, ...projectClaudeAgentMcpServers(registeredServers) }
  }

  queryOptions.settingSources = []

  const claudeConfigDir = activateClaudeAgentSdkConfigDir()
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
  const anthropicBaseUrl = resolveAnthropicBaseUrl(input.input.profile, config)
  if (anthropicBaseUrl) {
    env.ANTHROPIC_BASE_URL = anthropicBaseUrl
  }
  env.CRADLE_CHAT_SESSION_ID = input.input.runtimeSession.chatSessionId
  env.CRADLE_WORKSPACE_ID = input.input.workspaceId ?? undefined
  env.CRADLE_WORKSPACE_PATH = runtimeContext.workspacePath
  env.CRADLE_AGENT_ID = input.input.agentId ?? snapshot.agentId ?? undefined
  env.CRADLE_AGENT_HOME = runtimeContext.agentHome ?? undefined
  env.CLAUDE_CONFIG_DIR = claudeConfigDir
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  env.CLAUDE_CODE_ATTRIBUTION_HEADER = '0'

  Object.assign(env, buildClaudeAgentModelEnv({ model: effectiveModel, ...config.claudeAgent }))
  queryOptions.env = env

  return queryOptions
}

function readClaudeAgentEffort(
  override: NonNullable<StreamTurnInput['providerOptions']>['thinkingEffort'],
  configured: NonNullable<ReturnType<typeof readTrustedClaudeAgentConfig>['effort']>,
): 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
  switch (override) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return override
    default:
      return configured
  }
}

export function projectRuntimeSettingsToClaudePermissionMode(
  settings: ChatRuntimeSettings | null | undefined,
): 'bypassPermissions' | 'plan' | null {
  if (!settings) {
    return null
  }
  return settings.interactionMode === 'plan' || settings.accessMode === 'approval-required'
    ? 'plan'
    : 'bypassPermissions'
}

export function readClaudeAgentModelId(
  input: Pick<StreamTurnInput | GetCapabilitiesInput, 'modelId' | 'runtimeSession'>,
  config: ReturnType<typeof readTrustedClaudeAgentConfig>,
): string | undefined {
  if (input.modelId !== undefined) {
    return input.modelId ?? undefined
  }
  const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
  return snapshot.models.currentModelId ?? config.model
}

function formatClaudeAgentHistory(history: UIMessage[] | undefined, scope: 'full' | 'recentCradleLocal'): string | null {
  const scopedHistory = scope === 'recentCradleLocal'
    ? readRecentCradleLocalHistory(history)
    : history
  const entries = scopedHistory
    ?.map(message => formatClaudeAgentHistoryMessage(message, scope))
    .filter((entry): entry is string => Boolean(entry))
    ?? []
  return entries.length > 0 ? entries.join('\n\n') : null
}

function formatClaudeAgentHistoryMessage(message: UIMessage, scope: 'full' | 'recentCradleLocal'): string | null {
  const bangCommand = readBangCommandMetadata(message)
  if (bangCommand) {
    return `User ran local shell command: $ ${bangCommand.command}`
  }

  const bangResult = readBangResultMetadata(message)
  if (bangResult) {
    const output = bangResult.stdout || bangResult.stderr || '(no output)'
    const status = bangResult.exitCode === null ? 'unknown exit code' : `exit code ${bangResult.exitCode}`
    return [
      `Local shell command result for \`$ ${bangResult.command}\` (${status}, ${bangResult.durationMs}ms):`,
      output.trimEnd(),
    ].join('\n')
  }

  if (scope === 'recentCradleLocal') {
    return null
  }

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

function readRecentCradleLocalHistory(history: UIMessage[] | undefined): UIMessage[] | undefined {
  let latestAssistantIndex = -1
  for (let index = (history?.length ?? 0) - 1; index >= 0; index -= 1) {
    if (history?.[index]?.role === 'assistant') {
      latestAssistantIndex = index
      break
    }
  }
  return history?.slice(latestAssistantIndex + 1)
}

function projectClaudeAgentMcpServers(
  servers: ReturnType<typeof getRegisteredMcpServers>,
): Record<string, McpServerConfig> {
  return Object.fromEntries(
    Object.entries(servers).map(([name, config]) => {
      if (config.transport === 'stdio') {
        return [name, {
          type: 'stdio',
          command: config.command,
          args: config.args,
          env: config.env,
        } satisfies McpServerConfig]
      }

      return [name, {
        type: 'http',
        url: config.url,
        ...(Object.keys(config.headers).length > 0 ? { headers: config.headers } : {}),
      } satisfies McpServerConfig]
    }),
  )
}

function readBangCommandMetadata(message: UIMessage): { command: string } | null {
  const metadata = readRecord((message as { metadata?: unknown }).metadata)
  const cradleMetadata = readRecord(metadata.cradle)
  const bangCommand = readRecord(cradleMetadata.bangCommand)
  const command = typeof bangCommand.command === 'string' ? bangCommand.command.trim() : ''
  return command ? { command } : null
}

function readBangResultMetadata(message: UIMessage): {
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
} | null {
  const metadata = readRecord((message as { metadata?: unknown }).metadata)
  const cradleMetadata = readRecord(metadata.cradle)
  const bangResult = readRecord(cradleMetadata.bangResult)
  const command = typeof bangResult.command === 'string' ? bangResult.command.trim() : ''
  if (!command) {
    return null
  }

  return {
    command,
    stdout: typeof bangResult.stdout === 'string' ? bangResult.stdout : '',
    stderr: typeof bangResult.stderr === 'string' ? bangResult.stderr : '',
    exitCode: typeof bangResult.exitCode === 'number' ? bangResult.exitCode : null,
    durationMs: typeof bangResult.durationMs === 'number' ? bangResult.durationMs : 0,
  }
}

function toClaudeAgentImageBlock(part: Extract<MessagePart, { type: 'file' }>, runtimeLabel: string): ClaudeAgentContentBlock {
  const mediaType = toAnthropicImageMediaType(part.mediaType)
  if (!mediaType) {
    throw claudeAgentRequestError('projectImageInput', `${runtimeLabel} only supports jpeg, png, gif, and webp image input; unsupported file: ${describeUnsupportedFilePart(part)}`)
  }

  const dataUrl = parseDataUrl(part.url)
  if (dataUrl) {
    if (dataUrl.mediaType && dataUrl.mediaType !== mediaType) {
      throw claudeAgentRequestError('projectImageInput', `${runtimeLabel} image media type mismatch for ${describeFilePart(part)}: declared ${mediaType}, url ${dataUrl.mediaType}`)
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

  throw claudeAgentRequestError('projectImageInput', `${runtimeLabel} image input requires a data URL or http(s) URL; unsupported file: ${describeUnsupportedFilePart(part)}`)
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

function isClaudeTextBlock(block: unknown): block is Extract<ClaudeAgentContentBlock, { type: 'text' }> {
  return Boolean(block) && typeof block === 'object' && (block as { type?: unknown }).type === 'text'
}

function isClaudeImageBlock(block: unknown): block is Extract<ClaudeAgentContentBlock, { type: 'image' }> {
  return Boolean(block) && typeof block === 'object' && (block as { type?: unknown }).type === 'image'
}

function uniquePaths(paths: Array<string | null | undefined>): string[] {
  return [...new Set(paths.filter((path): path is string => Boolean(path)))]
}

function readSelectedSkillNames(message: RuntimeMessageInput): string[] {
  if (typeof message === 'string') {
    return []
  }
  return message.parts.flatMap((part) => {
    const skillPart = readChatSkillContextPart(part)
    return skillPart ? [skillPart.name] : []
  })
}

function resolveAnthropicBaseUrl(
  profile: RuntimeProviderTargetProfile,
  config: ReturnType<typeof readTrustedClaudeAgentConfig>,
): string | undefined {
  if (profile.providerKind === 'universal') {
    const universalConfig = readTrustedUniversalConfig(profile.configJson)
    return universalConfig.anthropicBaseUrl ?? undefined
  }
  return config.baseUrl ?? undefined
}

function buildClaudeAgentModelEnv(config: {
  model: string | undefined
  modelAliases?: {
    haiku?: string
    sonnet?: string
    opus?: string
  }
  subagentModel?: string
} | undefined): Record<string, string> {
  const env: Record<string, string> = {}
  const aliases = config?.modelAliases
  const haiku = readNonEmptyEnvValue(aliases?.haiku) || config?.model
  const sonnet = readNonEmptyEnvValue(aliases?.sonnet) || config?.model
  const opus = readNonEmptyEnvValue(aliases?.opus) || config?.model
  const subagentModel = readNonEmptyEnvValue(config?.subagentModel) || config?.model

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
  return trimmed || undefined
}

function claudeAgentRequestError(method: string, detail: string): ProviderRuntimeError {
  return new ProviderRuntimeError(ProviderErrors.requestFailed(CLAUDE_AGENT_RUNTIME_KIND, method, detail))
}
