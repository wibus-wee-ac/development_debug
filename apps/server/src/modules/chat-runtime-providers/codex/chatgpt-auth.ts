/**
 * Owns Cradle-side ChatGPT OAuth material for Codex app-server external auth.
 */
import { getLogger } from '../../../logging/logger'
import type { LoginAccountParams } from './app-server-protocol/v2/LoginAccountParams'

const CODEX_CHATGPT_AUTH_KIND = 'chatgpt-auth'
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const OPENAI_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const ACCESS_TOKEN_REFRESH_SKEW_SECONDS = 5 * 60

export interface CodexChatgptAuthCredential {
  credentialRef: string
  accessToken: string | null
  refreshToken: string | null
  chatgptAccountId: string
  chatgptPlanType: string | null
}

export interface CodexChatgptAuthDeps {
  updateSecretValue?: (credentialRef: string, secret: string) => void
}

export interface CodexAppServerAuthResolution {
  apiKey: string | null
  chatgptAuth: CodexChatgptAuthCredential | null
}

export interface CodexAppServerAuthCarrier {
  credentialRef?: string | null
  secretRef?: string | null
}

export interface CodexAppServerAuthResolverDeps {
  readSecret: (credentialRef: string) => string
}

interface OAuthTokenResponse {
  access_token?: unknown
  refresh_token?: unknown
  id_token?: unknown
}

interface ParsedJwtClaims {
  'email'?: string
  'exp'?: number
  'chatgpt_account_id'?: string
  'chatgpt_plan_type'?: string
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string
    chatgpt_plan_type?: string
  }
}

export function readCodexChatgptAuthCredential(
  credentialRef: string | null,
  rawSecret: string | null,
): CodexChatgptAuthCredential | null {
  if (!credentialRef || !rawSecret?.trim()) {
    return null
  }

  const parsed = parseJsonRecord(rawSecret)
  if (!parsed) {
    return null
  }

  const tokens = readRecord(parsed.tokens)
  const idToken = readRecord(tokens?.id_token)
  const accessToken = readString(parsed.accessToken)
    ?? readString(parsed.access_token)
    ?? readString(tokens?.access_token)
  const refreshToken = readString(parsed.refreshToken)
    ?? readString(parsed.refresh_token)
    ?? readString(tokens?.refresh_token)
  const claims = parseJwtClaims(accessToken) ?? parseJwtClaims(readString(idToken?.raw_jwt))
  const authClaims = readRecord(claims?.['https://api.openai.com/auth'])

  const chatgptAccountId = readString(parsed.chatgptAccountId)
    ?? readString(parsed.chatgpt_account_id)
    ?? readString(parsed.accountId)
    ?? readString(parsed.account_id)
    ?? readString(tokens?.account_id)
    ?? readString(idToken?.chatgpt_account_id)
    ?? readString(authClaims?.chatgpt_account_id)
    ?? readString(claims?.chatgpt_account_id)
  if (!chatgptAccountId) {
    return null
  }

  const chatgptPlanType = normalizePlanType(
    readString(parsed.chatgptPlanType)
    ?? readString(parsed.chatgpt_plan_type)
    ?? readString(parsed.planType)
    ?? readString(parsed.plan_type)
    ?? readPlanType(idToken?.chatgpt_plan_type)
    ?? readString(authClaims?.chatgpt_plan_type)
    ?? readString(claims?.chatgpt_plan_type),
  )

  return {
    credentialRef,
    accessToken,
    refreshToken,
    chatgptAccountId,
    chatgptPlanType,
  }
}

export function resolveCodexAppServerAuth(
  rawInput: CodexAppServerAuthCarrier,
  configApiKey: string | undefined,
  envVar: string,
  deps: CodexAppServerAuthResolverDeps,
): CodexAppServerAuthResolution {
  const credentialRef = rawInput.secretRef ?? rawInput.credentialRef ?? null
  if (credentialRef) {
    try {
      const secret = deps.readSecret(credentialRef)
      const chatgptAuth = readCodexChatgptAuthCredential(credentialRef, secret)
      if (chatgptAuth) {
        return { apiKey: null, chatgptAuth }
      }
      return { apiKey: secret, chatgptAuth: null }
    }
    catch (err) {
      // If credential decryption fails, log the error and fall through to other auth methods
      // This prevents server crashes when CRADLE_CREDENTIAL_SECRET changes or data is corrupted
      const logger = getLogger()
      if (err instanceof Error && err.message.includes('authenticate data')) {
        logger.warn('Failed to decrypt credential - CRADLE_CREDENTIAL_SECRET may have changed', {
          credentialRef,
          error: err.message,
        })
      }
      else {
        logger.error('Failed to read credential', { credentialRef, err })
      }
      // Fall through to try other auth methods
    }
  }
  if (configApiKey) {
    return { apiKey: configApiKey, chatgptAuth: null }
  }
  return { apiKey: process.env[envVar] ?? null, chatgptAuth: null }
}

export async function ensureCodexChatgptAuthAccessToken(
  credential: CodexChatgptAuthCredential,
  deps: CodexChatgptAuthDeps,
): Promise<CodexChatgptAuthCredential> {
  if (credential.accessToken && !isAccessTokenExpiring(credential.accessToken)) {
    return credential
  }
  return refreshCodexChatgptAuthCredential(credential, deps)
}

export function buildCodexChatgptAuthLoginParams(
  credential: CodexChatgptAuthCredential,
): LoginAccountParams {
  if (!credential.accessToken) {
    throw new Error('Codex ChatGPT auth requires an access token')
  }
  return {
    type: 'chatgptAuthTokens',
    accessToken: credential.accessToken,
    chatgptAccountId: credential.chatgptAccountId,
    chatgptPlanType: credential.chatgptPlanType,
  }
}

export async function refreshCodexChatgptAuthCredential(
  credential: CodexChatgptAuthCredential,
  deps: CodexChatgptAuthDeps,
): Promise<CodexChatgptAuthCredential> {
  if (!credential.refreshToken) {
    throw new Error('Codex ChatGPT auth refresh requires a refresh token')
  }

  const response = await fetch(OPENAI_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'cradle-codex-chatgpt-auth',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credential.refreshToken,
      client_id: CODEX_CLIENT_ID,
      scope: 'openid profile email',
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Codex ChatGPT auth refresh failed: ${response.status} ${text}`.trim())
  }

  const body = await response.json() as OAuthTokenResponse
  const accessToken = readString(body.access_token)
  if (!accessToken) {
    throw new Error('Codex ChatGPT auth refresh response is missing access_token')
  }

  const nextRefreshToken = readString(body.refresh_token) ?? credential.refreshToken
  const claims = parseJwtClaims(accessToken) ?? parseJwtClaims(readString(body.id_token))
  const authClaims = readRecord(claims?.['https://api.openai.com/auth'])
  const chatgptAccountId = readString(authClaims?.chatgpt_account_id)
    ?? readString(claims?.chatgpt_account_id)
    ?? credential.chatgptAccountId
  const chatgptPlanType = normalizePlanType(
    readString(authClaims?.chatgpt_plan_type)
    ?? readString(claims?.chatgpt_plan_type)
    ?? credential.chatgptPlanType,
  )

  const next: CodexChatgptAuthCredential = {
    credentialRef: credential.credentialRef,
    accessToken,
    refreshToken: nextRefreshToken,
    chatgptAccountId,
    chatgptPlanType,
  }
  deps.updateSecretValue?.(credential.credentialRef, JSON.stringify({
    kind: CODEX_CHATGPT_AUTH_KIND,
    accessToken,
    refreshToken: nextRefreshToken,
    chatgptAccountId,
    chatgptPlanType,
    updatedAt: Date.now(),
  }))
  return next
}

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  try {
    return readRecord(JSON.parse(raw))
  }
  catch {
    return null
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function readPlanType(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }
  const record = readRecord(value)
  return readString(record?.known) ?? readString(record?.unknown)
}

function normalizePlanType(value: string | null): string | null {
  return value?.trim().toLowerCase() || null
}

function isAccessTokenExpiring(token: string): boolean {
  const exp = parseJwtClaims(token)?.exp
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    return false
  }
  const nowSeconds = Math.floor(Date.now() / 1000)
  return exp <= nowSeconds + ACCESS_TOKEN_REFRESH_SKEW_SECONDS
}

function parseJwtClaims(token: string | null): ParsedJwtClaims | null {
  if (!token) {
    return null
  }
  const parts = token.split('.')
  if (parts.length < 2) {
    return null
  }
  try {
    const payload = parts[1]!
    const padded = payload.padEnd(payload.length + ((4 - payload.length % 4) % 4), '=')
    return JSON.parse(Buffer.from(padded, 'base64url').toString('utf8')) as ParsedJwtClaims
  }
  catch {
    return null
  }
}
