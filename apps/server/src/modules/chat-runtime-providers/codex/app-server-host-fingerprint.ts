import type { CodexAppServerClientOptions } from './app-server-client'
import type { CodexChatgptAuthCredential } from './chatgpt-auth'

export function createCodexAppServerHostFingerprint(input: {
  options: CodexAppServerClientOptions
  chatgptAuth: CodexChatgptAuthCredential | null
}): string {
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
    config: stableJson(input.options.config ?? null),
    env: input.options.env ?? null,
    userAgentMode: input.options.userAgentMode ?? null,
  })
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
