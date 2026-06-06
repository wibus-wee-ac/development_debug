/**
 * Output: Claude Agent provider snapshot projections for session-local runtime state.
 * Input: workspace provider snapshots and requested model ids.
 * Position: Claude Agent provider package owner for providerStateSnapshot updates.
 */

import type { RuntimeSession } from '../../chat-runtime/runtime-provider-types'
import type { WorkspaceProviderStateSnapshot } from '../provider-state-snapshot'
import { readWorkspaceProviderStateSnapshot } from '../provider-state-snapshot'

export function resolveClaudeAgentPendingModelSwitchId(snapshot: WorkspaceProviderStateSnapshot, requestedModelId: string | null): string | null {
  const existingPendingModelSwitchId = readClaudeAgentPendingModelSwitchId(snapshot)
  if (!requestedModelId) {
    return existingPendingModelSwitchId
  }
  if (requestedModelId !== snapshot.models.currentModelId) {
    return requestedModelId
  }
  return existingPendingModelSwitchId === requestedModelId ? existingPendingModelSwitchId : null
}

export function readClaudeAgentPendingModelSwitchId(snapshot: WorkspaceProviderStateSnapshot): string | null {
  const claudeAgentState = readRecord(snapshot.claudeAgent)
  const pendingModelSwitchId = typeof claudeAgentState.pendingModelSwitchId === 'string'
    ? claudeAgentState.pendingModelSwitchId.trim()
    : ''
  return pendingModelSwitchId || null
}

export function writeClaudeAgentPendingModelSwitch(
  snapshot: WorkspaceProviderStateSnapshot,
  pendingModelSwitchId: string | null,
): WorkspaceProviderStateSnapshot {
  const claudeAgentState = { ...readRecord(snapshot.claudeAgent) }
  if (pendingModelSwitchId) {
    claudeAgentState.pendingModelSwitchId = pendingModelSwitchId
  }
  else {
    delete claudeAgentState.pendingModelSwitchId
  }

  const nextSnapshot: WorkspaceProviderStateSnapshot = { ...snapshot }
  if (Object.keys(claudeAgentState).length > 0) {
    nextSnapshot.claudeAgent = claudeAgentState
  }
  else {
    delete nextSnapshot.claudeAgent
  }
  return nextSnapshot
}

export function clearClaudeAgentPendingModelSwitch(runtimeSession: RuntimeSession): void {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  runtimeSession.providerStateSnapshot = JSON.stringify(writeClaudeAgentPendingModelSwitch(snapshot, null))
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
