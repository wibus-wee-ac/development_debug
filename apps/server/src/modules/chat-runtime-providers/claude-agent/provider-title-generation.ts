/**
 * Title generation helper for Claude Agent provider.
 * Separated to avoid circular dependencies and type casting issues.
 */

import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'

import type { StreamTurnInput } from '../../chat-runtime/runtime-provider-types'
import { readTrustedClaudeAgentConfig, resolveApiKey } from '../../provider-contracts/provider-base'
import { createBoundedTextCollector } from '../bounded-text-collector'
import { activateClaudeAgentSdkConfigDir, resolveClaudeAgentRuntimeContext } from './runtime-context'
import type { ClaudeAgentProviderDeps, ClaudeTitleGenerationThinkingEffort } from './types'

const CLAUDE_SESSION_TITLE_MAX_LENGTH = 60
const CLAUDE_SESSION_TITLE_TIMEOUT_MS = 30000

const CLAUDE_SESSION_TITLE_PROMPT_PREFIX = [
  'You are naming a Claude Agent task session.',
  'Generate a concise UI title for the user prompt below.',
  `Keep it at or below ${CLAUDE_SESSION_TITLE_MAX_LENGTH} characters when possible.`,
  'Use the same language as the user prompt.',
  'Do not answer the prompt.',
  'Do not use quotes.',
  'Output only the title text.',
].join('\n')

export async function generateClaudeSessionTitle(input: {
  profile: StreamTurnInput['profile']
  promptText: string
  modelId: string | null
  thinkingEffort: ClaudeTitleGenerationThinkingEffort
  workspacePath: string
  agentId: string | null
  deps: ClaudeAgentProviderDeps
  signal: AbortSignal
}): Promise<string | null> {
  const titlePrompt = `${CLAUDE_SESSION_TITLE_PROMPT_PREFIX}\n\n${input.promptText}`
  const abortController = new AbortController()
  const runtimeContext = resolveClaudeAgentRuntimeContext(input.workspacePath, input.agentId)

  const timeout = setTimeout(() => abortController.abort(), CLAUDE_SESSION_TITLE_TIMEOUT_MS)
  const abortTitleRead = () => abortController.abort()
  input.signal.addEventListener('abort', abortTitleRead, { once: true })

  let apiKey: string | null = null

  try {
    const config = readTrustedClaudeAgentConfig(input.profile.configJson)
    apiKey = resolveApiKey(input.profile, config.apiKey, 'ANTHROPIC_API_KEY', input.deps)

    if (!apiKey) {
      input.deps.logger?.warn('claude session title generation skipped: no api key resolved', {
        modelId: input.modelId ?? null,
        profileId: input.profile.id,
      })
      return null
    }

    const claudeConfigDir = activateClaudeAgentSdkConfigDir()
    const queryOptions: Options = {
      abortController,
      cwd: runtimeContext.cwd,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      model: input.modelId ?? config.model ?? undefined,
      effort: input.thinkingEffort === 'minimal' ? 'low' : input.thinkingEffort,
      persistSession: false,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: apiKey,
        CLAUDE_CONFIG_DIR: claudeConfigDir,
        CRADLE_WORKSPACE_PATH: runtimeContext.workspacePath,
        CRADLE_AGENT_ID: input.agentId ?? undefined,
        CRADLE_AGENT_HOME: runtimeContext.agentHome ?? undefined,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        CLAUDE_CODE_ATTRIBUTION_HEADER: '0',
      },
    }

    const titleQuery = query({
      prompt: titlePrompt,
      options: queryOptions,
    })

    const titleCollector = createBoundedTextCollector()

    for await (const message of titleQuery) {
      if (abortController.signal.aborted || input.signal.aborted) {
        break
      }

      if (message.type === 'assistant') {
        const text = (message as any).text
        if (typeof text === 'string') {
          titleCollector.append(text)
        }
      }

      if (message.type === 'result') {
        break
      }
    }

    titleQuery.close()
    const generatedTitle = titleCollector.read()?.trim() ?? ''
    if (generatedTitle.length === 0) {
      input.deps.logger?.warn('claude session title generation produced no assistant text', {
        modelId: input.modelId ?? null,
      })
      return null
    }
    if (generatedTitle.length > CLAUDE_SESSION_TITLE_MAX_LENGTH * 1.5) {
      input.deps.logger?.warn('claude session title generation exceeded length cap', {
        modelId: input.modelId ?? null,
        length: generatedTitle.length,
        cap: CLAUDE_SESSION_TITLE_MAX_LENGTH * 1.5,
        preview: generatedTitle.slice(0, 80),
      })
      return null
    }
    return generatedTitle
  }
  catch (error) {
    input.deps.logger?.warn('claude session title generation failed', {
      err: error,
      modelId: input.modelId ?? null,
      hasApiKey: Boolean(apiKey),
    })
    return null
  }
  finally {
    clearTimeout(timeout)
    input.signal.removeEventListener('abort', abortTitleRead)
  }
}

export function shouldGenerateClaudeSessionTitle(input: {
  providerSessionId: string | null
  promptText: string
}): boolean {
  return !input.providerSessionId
    && input.promptText.length > 0
}

export { CLAUDE_SESSION_TITLE_MAX_LENGTH, CLAUDE_SESSION_TITLE_PROMPT_PREFIX, CLAUDE_SESSION_TITLE_TIMEOUT_MS }
