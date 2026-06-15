import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getRegisteredMcpServers } from '../../../../plugins'
import type {
  ChatRuntimeAccessMode,
  ChatRuntimeSettings,
  ChatThinkingEffort,
} from '../../../chat-runtime/runtime-provider-types'
import type { CodexAuthMode, CodexConfig } from '../../../provider-contracts/provider-base'
import type { CollaborationMode } from '../app-server-protocol/CollaborationMode'
import type { ReasoningEffort } from '../app-server-protocol/ReasoningEffort'
import type { ThreadForkParams } from '../app-server-protocol/v2/ThreadForkParams'
import type { SandboxPolicy } from '../app-server-protocol/v2/SandboxPolicy'
import type { CodexAppServerAuthResolution } from '../app-server/chatgpt-auth'
import { toSandboxPolicy } from './sandbox-policy'

export const CRADLE_CODEX_MODEL_PROVIDER = 'cradle-openai-compatible'
export const CRADLE_CODEX_API_KEY_ENV = 'CRADLE_CODEX_API_KEY'

export function resolveCodexExternalModelProviderBaseUrl(
  config: CodexConfig,
): string | null {
  const baseUrl = config.baseUrl?.trim()
  return baseUrl ? baseUrl : null
}

export function resolveCodexAuthMode(
  config: CodexConfig,
  auth: CodexAppServerAuthResolution,
): CodexAuthMode {
  if (auth.chatgptAuth) {
    return 'chatgptAuthTokens'
  }
  if (auth.apiKey) {
    return 'apikey'
  }
  return config.authMode ?? 'apikey'
}

export function codexConfigRequiresApiKey(
  config: CodexConfig,
  auth: CodexAppServerAuthResolution,
): boolean {
  return resolveCodexExternalModelProviderBaseUrl(config) !== null
    && resolveCodexAuthMode(config, auth) === 'apikey'
    && !auth.apiKey
}

export function buildCodexExternalModelProviderConfig(
  baseUrl: string,
  authMode: CodexAuthMode,
): Record<string, unknown> {
  return {
    model_provider: CRADLE_CODEX_MODEL_PROVIDER,
    model_providers: {
      [CRADLE_CODEX_MODEL_PROVIDER]: {
        name: 'Cradle OpenAI Compatible',
        base_url: baseUrl,
        ...(authMode === 'apikey' ? { env_key: CRADLE_CODEX_API_KEY_ENV } : {}),
        wire_api: 'responses',
        requires_openai_auth: true,
      },
    },
  }
}

export function resolveCodexSkillExtraRoots(
  config: CodexConfig,
  workspacePath: string,
  resolveSkillPaths: (workspacePath: string) => string[],
): string[] {
  return config.skillPaths.length > 0
    ? config.skillPaths
    : resolveSkillPaths(workspacePath)
}

export function readCodexReasoningEffort(
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

export function buildCodexConfig(
  config: CodexConfig,
  _workspacePath: string,
  _resolveSkillPaths: (workspacePath: string) => string[],
  systemPromptFile: string | null,
  effectiveModel: string | null | undefined,
  auth: CodexAppServerAuthResolution,
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
  const authMode = resolveCodexAuthMode(config, auth)
  const externalBaseUrl = resolveCodexExternalModelProviderBaseUrl(config)
  if (externalBaseUrl) {
    Object.assign(codexConfig, buildCodexExternalModelProviderConfig(externalBaseUrl, authMode))
  }
  if (effectiveModel) {
    codexConfig.model = effectiveModel
  }
  return codexConfig
}

export function writeSystemPromptFile(systemPrompt: string | undefined): string | null {
  if (!systemPrompt) {
    return null
  }
  const filePath = join(tmpdir(), `cradle-codex-prompt-${randomUUID()}.md`)
  writeFileSync(filePath, systemPrompt, 'utf-8')
  return filePath
}

export function projectCodexRuntimeAccessMode(
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

export function buildCodexCollaborationMode(
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

function isCodexReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === 'none'
    || value === 'minimal'
    || value === 'low'
    || value === 'medium'
    || value === 'high'
    || value === 'xhigh'
}
