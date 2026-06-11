import type { CodexAuthMode, CodexConfig } from '../../provider-contracts/provider-base'
import type { CodexAppServerAuthResolution } from './chatgpt-auth'

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
