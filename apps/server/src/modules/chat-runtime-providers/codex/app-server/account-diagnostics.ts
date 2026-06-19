import type { ConsumeAccountRateLimitResetCreditParams } from '../app-server-protocol/v2/ConsumeAccountRateLimitResetCreditParams'
import type { ConsumeAccountRateLimitResetCreditResponse } from '../app-server-protocol/v2/ConsumeAccountRateLimitResetCreditResponse'
import type { GetAccountRateLimitsResponse } from '../app-server-protocol/v2/GetAccountRateLimitsResponse'
import type { GetAccountTokenUsageResponse } from '../app-server-protocol/v2/GetAccountTokenUsageResponse'
import type { RateLimitSnapshot } from '../app-server-protocol/v2/RateLimitSnapshot'
import type { RateLimitWindow } from '../app-server-protocol/v2/RateLimitWindow'
import { readTrustedCodexConfig } from '../../../provider-contracts/provider-base'
import { AppError } from '../../../../errors/app-error'
import * as Preferences from '../../../preferences/service'
import * as ProviderTargets from '../../../provider-targets/service'
import * as Secrets from '../../../secrets/service'
import { CODEX_RUNTIME_KIND } from '../metadata'
import { buildCodexConfig } from '../config/runtime-config'
import { resolveCodexRuntimeContext } from '../config/runtime-context'
import type { CodexAppServerClientOptions } from './client'
import { buildDefaultCodexAppServerRequestResult } from './bridge'
import {
  type CodexAppServerAuthResolution,
  readCodexApiKeyAuth,
  readCodexChatgptAuth,
  resolveCodexAppServerAuth,
} from './chatgpt-auth'
import { buildCodexAppServerEnv } from './env'
import { acquireCodexAppServerHostLease } from './host-lease'
import type { CodexAppServerClientLike } from '../types'

export interface CodexRateLimitWindowDiagnostics {
  usedPercent: number
  windowDurationMins: number | null
  resetsAt: number | null
}

export interface CodexSpendControlLimitDiagnostics {
  limit: string
  used: string
  remainingPercent: number
  resetsAt: number
}

export interface CodexRateLimitSnapshotDiagnostics {
  limitId: string | null
  limitName: string | null
  primary: CodexRateLimitWindowDiagnostics | null
  secondary: CodexRateLimitWindowDiagnostics | null
  credits: {
    hasCredits: boolean
    unlimited: boolean
    balance: string | null
  } | null
  individualLimit: CodexSpendControlLimitDiagnostics | null
  planType: string | null
  rateLimitReachedType: string | null
}

export interface CodexAccountDiagnostics {
  providerTargetId: string
  supported: boolean
  unavailableReason: string | null
  refreshedAt: number | null
  account: {
    authMode: 'chatgptAuthTokens'
    planType: string | null
  } | null
  rateLimits: CodexRateLimitSnapshotDiagnostics | null
  rateLimitsByLimitId: Record<string, CodexRateLimitSnapshotDiagnostics> | null
  rateLimitResetCredits: {
    availableCount: string
  } | null
  tokenUsage: {
    summary: {
      lifetimeTokens: string | null
      peakDailyTokens: string | null
      longestRunningTurnSec: string | null
      currentStreakDays: string | null
      longestStreakDays: string | null
    }
    dailyUsageBuckets: Array<{
      startDate: string
      tokens: string
    }>
  } | null
}

export interface CodexRateLimitResetCreditConsumption {
  providerTargetId: string
  outcome: ConsumeAccountRateLimitResetCreditResponse['outcome']
  consumedAt: number
}

interface CodexAccountDiagnosticsDeps {
  resolveProviderTarget: typeof ProviderTargets.resolveProviderTarget
  readSecret: typeof Secrets.readSecret
  readSecretValueWithMetadata: typeof Secrets.readSecretValueWithMetadata
  updateSecretValue: typeof Secrets.updateSecretValue
  readCodexPreferences: typeof Preferences.getCodexPreferencesSync
  createAppServerClient?: (options: CodexAppServerClientOptions) => CodexAppServerClientLike
}

interface SupportedCodexAccountDiagnosticsTarget {
  supported: true
  target: ReturnType<typeof ProviderTargets.resolveProviderTarget>
  config: ReturnType<typeof readTrustedCodexConfig>
  auth: Extract<CodexAppServerAuthResolution, { kind: 'chatgptAuthTokens' }>
}

interface UnsupportedCodexAccountDiagnosticsTarget {
  supported: false
  providerTargetId: string
  unavailableReason: string
}

type CodexAccountDiagnosticsTarget =
  | SupportedCodexAccountDiagnosticsTarget
  | UnsupportedCodexAccountDiagnosticsTarget

const DEFAULT_CODEX_ACCOUNT_DIAGNOSTICS_DEPS: CodexAccountDiagnosticsDeps = {
  resolveProviderTarget: ProviderTargets.resolveProviderTarget,
  readSecret: Secrets.readSecret,
  readSecretValueWithMetadata: Secrets.readSecretValueWithMetadata,
  updateSecretValue: Secrets.updateSecretValue,
  readCodexPreferences: Preferences.getCodexPreferencesSync,
}

export async function readCodexAccountDiagnostics(
  input: { providerTargetId: string },
  deps: CodexAccountDiagnosticsDeps = DEFAULT_CODEX_ACCOUNT_DIAGNOSTICS_DEPS,
): Promise<CodexAccountDiagnostics> {
  const resolved = resolveSupportedCodexAccountDiagnosticsTarget(input.providerTargetId, deps)
  if (!resolved.supported) {
    return {
      providerTargetId: resolved.providerTargetId,
      supported: false,
      unavailableReason: resolved.unavailableReason,
      refreshedAt: null,
      account: null,
      rateLimits: null,
      rateLimitsByLimitId: null,
      rateLimitResetCredits: null,
      tokenUsage: null,
    }
  }

  const { target, config, auth } = resolved
  const chatgptAuth = readCodexChatgptAuth(auth)!
  const hostLease = await acquireDiagnosticsHostLease({
    providerTargetId: target.id,
    config,
    auth,
    deps,
  })
  const client = hostLease.resource.client

  try {
    const [rateLimitsResponse, usageResponse] = await Promise.all([
      client.request('account/rateLimits/read', {}) as Promise<GetAccountRateLimitsResponse>,
      client.request('account/usage/read', {}) as Promise<GetAccountTokenUsageResponse>,
    ])

    return {
      providerTargetId: target.id,
      supported: true,
      unavailableReason: null,
      refreshedAt: Date.now(),
      account: {
        authMode: 'chatgptAuthTokens',
        planType: chatgptAuth.chatgptPlanType ?? rateLimitsResponse.rateLimits.planType,
      },
      rateLimits: projectRateLimitSnapshot(rateLimitsResponse.rateLimits),
      rateLimitsByLimitId: projectRateLimitsByLimitId(rateLimitsResponse.rateLimitsByLimitId),
      rateLimitResetCredits: rateLimitsResponse.rateLimitResetCredits
        ? { availableCount: formatCounter(rateLimitsResponse.rateLimitResetCredits.availableCount) }
        : null,
      tokenUsage: projectTokenUsage(usageResponse),
    }
  }
  finally {
    hostLease.release()
  }
}

export async function consumeCodexRateLimitResetCredit(
  input: { providerTargetId: string, idempotencyKey: string },
  deps: CodexAccountDiagnosticsDeps = DEFAULT_CODEX_ACCOUNT_DIAGNOSTICS_DEPS,
): Promise<CodexRateLimitResetCreditConsumption> {
  const resolved = resolveSupportedCodexAccountDiagnosticsTarget(input.providerTargetId, deps)
  if (!resolved.supported) {
    throw new AppError({
      code: 'codex_account_diagnostics_unsupported',
      status: 400,
      message: resolved.unavailableReason,
      details: { providerTargetId: resolved.providerTargetId },
    })
  }

  const hostLease = await acquireDiagnosticsHostLease({
    providerTargetId: resolved.target.id,
    config: resolved.config,
    auth: resolved.auth,
    deps,
  })
  const client = hostLease.resource.client

  try {
    const params: ConsumeAccountRateLimitResetCreditParams = {
      idempotencyKey: input.idempotencyKey,
    }
    const response = await client.request('account/rateLimitResetCredit/consume', params) as ConsumeAccountRateLimitResetCreditResponse
    return {
      providerTargetId: resolved.target.id,
      outcome: response.outcome,
      consumedAt: Date.now(),
    }
  }
  finally {
    hostLease.release()
  }
}

function resolveSupportedCodexAccountDiagnosticsTarget(
  providerTargetId: string,
  deps: CodexAccountDiagnosticsDeps,
): CodexAccountDiagnosticsTarget {
  const target = deps.resolveProviderTarget(providerTargetId)
  if (target.providerKind !== 'openai-compatible') {
    return {
      supported: false,
      providerTargetId: target.id,
      unavailableReason: 'Codex account diagnostics are only available for Codex provider targets.',
    }
  }

  const config = readTrustedCodexConfig(target.configJson)
  const auth = resolveCodexAppServerAuth({ credentialRef: target.credentialRef }, config, 'OPENAI_API_KEY', deps)
  if (auth.kind !== 'chatgptAuthTokens') {
    return {
      supported: false,
      providerTargetId: target.id,
      unavailableReason: 'Codex account diagnostics require ChatGPT account auth.',
    }
  }

  return {
    supported: true,
    target,
    config,
    auth,
  }
}

async function acquireDiagnosticsHostLease(input: {
  providerTargetId: string
  config: ReturnType<typeof readTrustedCodexConfig>
  auth: Extract<CodexAppServerAuthResolution, { kind: 'chatgptAuthTokens' }>
  deps: CodexAccountDiagnosticsDeps
}) {
  const workspacePath = process.cwd()
  const runtimeContext = resolveCodexRuntimeContext(workspacePath, null)
  const diagnosticsScopeId = `provider-target-diagnostics:${input.providerTargetId}`
  const chatgptAuth = readCodexChatgptAuth(input.auth)

  return await acquireCodexAppServerHostLease({
    runtimeKind: CODEX_RUNTIME_KIND,
    providerTargetId: input.providerTargetId,
    scopeId: diagnosticsScopeId,
    chatgptAuth,
    options: {
      apiKey: readCodexApiKeyAuth(input.auth) ?? undefined,
      config: buildCodexConfig(input.config, workspacePath, () => [], null, input.config.model, input.auth),
      env: buildCodexAppServerEnv({
        chatSessionId: diagnosticsScopeId,
        workspacePath,
        agentId: null,
        agentHome: runtimeContext.agentHome,
      }, input.auth),
      serverRequestHandler: request => buildDefaultCodexAppServerRequestResult(request, {
        chatgptAuth,
        updateSecretValue: input.deps.updateSecretValue,
      }),
    },
    deps: {
      createAppServerClient: input.deps.createAppServerClient,
      readCodexPreferences: input.deps.readCodexPreferences,
      updateSecretValue: input.deps.updateSecretValue,
    },
  })
}

function projectRateLimitSnapshot(
  snapshot: RateLimitSnapshot | null,
): CodexRateLimitSnapshotDiagnostics | null {
  if (!snapshot) {
    return null
  }
  return {
    limitId: snapshot.limitId,
    limitName: snapshot.limitName,
    primary: projectRateLimitWindow(snapshot.primary),
    secondary: projectRateLimitWindow(snapshot.secondary),
    credits: snapshot.credits
      ? {
          hasCredits: snapshot.credits.hasCredits,
          unlimited: snapshot.credits.unlimited,
          balance: snapshot.credits.balance,
        }
      : null,
    individualLimit: snapshot.individualLimit
      ? {
          limit: snapshot.individualLimit.limit,
          used: snapshot.individualLimit.used,
          remainingPercent: snapshot.individualLimit.remainingPercent,
          resetsAt: snapshot.individualLimit.resetsAt,
        }
      : null,
    planType: snapshot.planType,
    rateLimitReachedType: snapshot.rateLimitReachedType,
  }
}

function projectRateLimitsByLimitId(
  snapshots: GetAccountRateLimitsResponse['rateLimitsByLimitId'],
): Record<string, CodexRateLimitSnapshotDiagnostics> | null {
  if (!snapshots) {
    return null
  }
  return Object.fromEntries(
    Object.entries(snapshots)
      .filter((entry): entry is [string, RateLimitSnapshot] => Boolean(entry[1]))
      .map(([limitId, snapshot]) => [limitId, projectRateLimitSnapshot(snapshot)!]),
  )
}

function projectRateLimitWindow(
  window: RateLimitWindow | null,
): CodexRateLimitWindowDiagnostics | null {
  if (!window) {
    return null
  }
  return {
    usedPercent: window.usedPercent,
    windowDurationMins: window.windowDurationMins,
    resetsAt: window.resetsAt,
  }
}

function projectTokenUsage(response: GetAccountTokenUsageResponse): CodexAccountDiagnostics['tokenUsage'] {
  return {
    summary: {
      lifetimeTokens: formatNullableCounter(response.summary.lifetimeTokens),
      peakDailyTokens: formatNullableCounter(response.summary.peakDailyTokens),
      longestRunningTurnSec: formatNullableCounter(response.summary.longestRunningTurnSec),
      currentStreakDays: formatNullableCounter(response.summary.currentStreakDays),
      longestStreakDays: formatNullableCounter(response.summary.longestStreakDays),
    },
    dailyUsageBuckets: (response.dailyUsageBuckets ?? []).map(bucket => ({
      startDate: bucket.startDate,
      tokens: formatCounter(bucket.tokens),
    })),
  }
}

function formatNullableCounter(value: bigint | number | string | null): string | null {
  return value === null ? null : formatCounter(value)
}

function formatCounter(value: bigint | number | string): string {
  return String(value)
}
