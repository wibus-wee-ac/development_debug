import type { CodexAppServerClientOptions } from './client'
import type { CodexChatgptAuthCredential } from './chatgpt-auth'

/**
 * Creates a fingerprint for Codex app-server host resource that includes only
 * process-level configuration. Thread-level config (approval_policy, sandbox_mode,
 * model, etc.) and per-thread env vars (CRADLE_CHAT_SESSION_ID, etc.) are omitted
 * because they can be passed via thread/start or thread/resume params.
 */
export function createCodexAppServerHostFingerprint(input: {
  options: CodexAppServerClientOptions
  chatgptAuth: CodexChatgptAuthCredential | null
}): string {
  // Extract only process-level config that affects app-server lifetime:
  // - baseUrl and model_provider affect which API the process connects to
  // - Other config keys (approval_policy, sandbox_mode, model, etc.) are thread-level
  const processLevelConfig = input.options.config
    ? extractProcessLevelConfig(input.options.config)
    : null

  return JSON.stringify({
    apiKey: input.options.apiKey ?? null,
    chatgptAuth: input.chatgptAuth
      ? {
          credentialRef: input.chatgptAuth.credentialRef,
          accountId: input.chatgptAuth.chatgptAccountId,
          planType: input.chatgptAuth.chatgptPlanType,
        }
      : null,
    codexPath: input.options.codexPath ?? null,
    processLevelConfig: stableJson(processLevelConfig),
    userAgentMode: input.options.userAgentMode ?? null,
  })
}

function extractProcessLevelConfig(config: Record<string, unknown>): Record<string, unknown> | null {
  const processKeys = ['model_provider', 'model_providers']
  const processConfig: Record<string, unknown> = {}
  for (const key of processKeys) {
    if (key in config) {
      processConfig[key] = config[key]
    }
  }
  return Object.keys(processConfig).length > 0 ? processConfig : null
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value))
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJsonValue(entry)]),
    )
  }
  return value
}
