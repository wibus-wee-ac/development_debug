import type { BackendSessionBinding } from '@cradle/db'
import type { UIMessageChunk } from 'ai'

import { readProviderStateSnapshot } from '../../chat-runtime-providers/provider-state-snapshot'
import { createChildLogger } from '../../../logging/logger'

const CODEX_GOAL_CONTINUATION_DELAY_MS = 250

const codexGoalContinuationLogger = createChildLogger({
  module: 'chat-runtime.codex-goal-continuation'
})

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>()
const failureCounts = new Map<string, number>()

export interface CodexGoalContinuationRunContext {
  sessionId: string
  runtimeKind: string
  cancelRequested: boolean
  internalContinuation?: 'codexGoal' | null
}

export interface CodexGoalContinuationDecisionInput {
  run: CodexGoalContinuationRunContext
  finalChunk: UIMessageChunk
  binding: BackendSessionBinding | undefined
  providerTargetAvailable: boolean
  pendingQueueItemCount: number
}

export interface CodexGoalContinuationSchedulerDeps {
  hasActiveOrPendingRun(sessionId: string): boolean
  pendingQueueItemCount(sessionId: string): number
  scheduleQueueDrain(sessionId: string): void
  getBinding(sessionId: string): BackendSessionBinding | undefined
  isProviderTargetAvailable(providerTargetId: string | null | undefined): boolean
  onContinuationScheduled?(input: CodexGoalContinuationScheduleInput & { delayMs: number }): void
  onContinuationStarted?(input: CodexGoalContinuationScheduleInput): void
  createContinuationRun(input: {
    sessionId: string
    providerTargetId?: string
    modelId?: string
  }): Promise<void>
}

export interface CodexGoalContinuationScheduleInput {
  sessionId: string
  providerTargetId?: string
  modelId?: string
}

export function hasActiveCodexGoal(rawProviderStateSnapshot: string | null | undefined): boolean {
  try {
    const snapshot = readProviderStateSnapshot(rawProviderStateSnapshot)
    const codex = readUnknownRecord(snapshot.codex)
    const goal = readUnknownRecord(codex.goal)
    return (
      goal.status === 'active' &&
      typeof goal.objective === 'string' &&
      goal.objective.trim().length > 0
    )
  } catch {
    return false
  }
}

export function cancelPendingCodexGoalContinuation(sessionId: string): void {
  const timer = pendingTimers.get(sessionId)
  if (!timer) {
    return
  }
  clearTimeout(timer)
  pendingTimers.delete(sessionId)
}

export function updateCodexGoalContinuationBackoff(
  activeRun: CodexGoalContinuationRunContext,
  finalChunk: UIMessageChunk
): void {
  if (activeRun.internalContinuation !== 'codexGoal') {
    return
  }
  if (finalChunk.type === 'error') {
    failureCounts.set(activeRun.sessionId, (failureCounts.get(activeRun.sessionId) ?? 0) + 1)
    return
  }
  failureCounts.delete(activeRun.sessionId)
}

export function shouldScheduleCodexGoalContinuation(
  input: CodexGoalContinuationDecisionInput
): boolean {
  if (input.run.runtimeKind !== 'codex') {
    return false
  }
  if (input.run.cancelRequested || input.finalChunk.type === 'abort') {
    return false
  }
  if (
    input.binding?.runtimeKind !== 'codex' ||
    !hasActiveCodexGoal(input.binding.backendStateSnapshot)
  ) {
    return false
  }
  if (!input.providerTargetAvailable) {
    return false
  }
  if (input.pendingQueueItemCount > 0) {
    return false
  }
  return true
}

export function scheduleCodexGoalContinuation(
  input: CodexGoalContinuationScheduleInput,
  deps: CodexGoalContinuationSchedulerDeps
): void {
  if (pendingTimers.has(input.sessionId)) {
    return
  }

  const failureCount = failureCounts.get(input.sessionId) ?? 0
  const delayMs = Math.min(
    CODEX_GOAL_CONTINUATION_DELAY_MS * 2 ** Math.min(failureCount, 7),
    30_000
  )

  const timer = setTimeout(() => {
    pendingTimers.delete(input.sessionId)
    void startScheduledCodexGoalContinuation(input, deps)
  }, delayMs)
  pendingTimers.set(input.sessionId, timer)
  deps.onContinuationScheduled?.({ ...input, delayMs })
}

async function startScheduledCodexGoalContinuation(
  input: CodexGoalContinuationScheduleInput,
  deps: CodexGoalContinuationSchedulerDeps
): Promise<void> {
  if (deps.hasActiveOrPendingRun(input.sessionId)) {
    return
  }
  if (deps.pendingQueueItemCount(input.sessionId) > 0) {
    deps.scheduleQueueDrain(input.sessionId)
    return
  }
  const binding = deps.getBinding(input.sessionId)
  if (binding?.runtimeKind !== 'codex' || !hasActiveCodexGoal(binding.backendStateSnapshot)) {
    return
  }
  if (!deps.isProviderTargetAvailable(input.providerTargetId ?? binding.providerTargetId)) {
    return
  }

  try {
    deps.onContinuationStarted?.(input)
    await deps.createContinuationRun({
      sessionId: input.sessionId,
      providerTargetId: input.providerTargetId,
      modelId: input.modelId
    })
  } catch (error) {
    failureCounts.set(input.sessionId, (failureCounts.get(input.sessionId) ?? 0) + 1)
    codexGoalContinuationLogger.warn('failed to start Codex goal continuation run', {
      error,
      sessionId: input.sessionId
    })
    const latestBinding = deps.getBinding(input.sessionId)
    if (
      !deps.hasActiveOrPendingRun(input.sessionId) &&
      latestBinding?.runtimeKind === 'codex' &&
      hasActiveCodexGoal(latestBinding.backendStateSnapshot) &&
      deps.isProviderTargetAvailable(input.providerTargetId ?? latestBinding.providerTargetId) &&
      deps.pendingQueueItemCount(input.sessionId) === 0
    ) {
      scheduleCodexGoalContinuation(input, deps)
    }
  }
}

function readUnknownRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
