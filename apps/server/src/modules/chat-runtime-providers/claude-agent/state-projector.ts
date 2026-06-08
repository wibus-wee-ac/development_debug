/**
 * Output: Claude Agent provider snapshot projections for session-local runtime state.
 * Input: workspace provider snapshots and requested model ids.
 * Position: Claude Agent provider package owner for providerStateSnapshot updates.
 */

import type { RuntimePlanStepStatus, RuntimePlanUiSlotState, RuntimeSession } from '../../chat-runtime/runtime-provider-types'
import type { ClaudeAgentCapturedPlan } from './event-to-chunk-mapper'
import type { WorkspaceProviderStateSnapshot } from '../provider-state-snapshot'
import { readWorkspaceProviderStateSnapshot } from '../provider-state-snapshot'

interface ClaudeAgentPlanSnapshot {
  threadId: string
  turnId: string
  content: string
  steps: Array<{ step: string, status: RuntimePlanStepStatus }>
  updatedAt: number
}

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

export function clearClaudeAgentCapturedPlan(runtimeSession: RuntimeSession): void {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  const claudeAgentState = { ...readRecord(snapshot.claudeAgent) }
  delete claudeAgentState.plan

  const nextSnapshot: WorkspaceProviderStateSnapshot = { ...snapshot }
  if (Object.keys(claudeAgentState).length > 0) {
    nextSnapshot.claudeAgent = claudeAgentState
  }
  else {
    delete nextSnapshot.claudeAgent
  }
  runtimeSession.providerStateSnapshot = JSON.stringify(nextSnapshot)
}

export function writeClaudeAgentCapturedPlan(runtimeSession: RuntimeSession, plan: ClaudeAgentCapturedPlan, updatedAt: number = Date.now()): void {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  const claudeAgentState = {
    ...readRecord(snapshot.claudeAgent),
    plan: {
      threadId: runtimeSession.chatSessionId,
      turnId: plan.toolCallId,
      content: plan.content,
      steps: projectPlanSteps(plan.content),
      updatedAt,
    } satisfies ClaudeAgentPlanSnapshot,
  }
  runtimeSession.providerStateSnapshot = JSON.stringify({
    ...snapshot,
    claudeAgent: claudeAgentState,
  })
}

export function projectClaudeAgentPlanUiSlotState(runtimeSession: RuntimeSession): RuntimePlanUiSlotState | null {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  const plan = readClaudeAgentPlanSnapshot(snapshot)
  if (!plan || plan.threadId !== runtimeSession.chatSessionId) {
    return null
  }
  const pendingCount = plan.steps.filter(step => step.status === 'pending').length
  const inProgressCount = plan.steps.filter(step => step.status === 'inProgress').length
  const completedCount = plan.steps.filter(step => step.status === 'completed').length
  return {
    kind: 'plan',
    slotId: 'claude-agent:plan',
    threadId: plan.threadId,
    turnId: plan.turnId,
    explanation: null,
    content: plan.content,
    steps: plan.steps,
    currentStep: plan.steps.find(step => step.status === 'inProgress')?.step
      ?? plan.steps.find(step => step.status === 'pending')?.step
      ?? null,
    pendingCount,
    inProgressCount,
    completedCount,
    updatedAt: plan.updatedAt,
  }
}

function readClaudeAgentPlanSnapshot(snapshot: WorkspaceProviderStateSnapshot): ClaudeAgentPlanSnapshot | null {
  const plan = readRecord(readRecord(snapshot.claudeAgent).plan)
  const threadId = typeof plan.threadId === 'string' ? plan.threadId : ''
  const turnId = typeof plan.turnId === 'string' ? plan.turnId : ''
  const content = typeof plan.content === 'string' ? plan.content.trim() : ''
  const updatedAt = typeof plan.updatedAt === 'number' ? plan.updatedAt : 0
  if (!threadId || !turnId || !content || updatedAt <= 0) {
    return null
  }
  return {
    threadId,
    turnId,
    content,
    steps: readClaudeAgentPlanSteps(plan.steps, content),
    updatedAt,
  }
}

function readClaudeAgentPlanSteps(value: unknown, content: string): ClaudeAgentPlanSnapshot['steps'] {
  if (!Array.isArray(value)) {
    return projectPlanSteps(content)
  }
  const steps = value.flatMap((item): ClaudeAgentPlanSnapshot['steps'] => {
    const record = readRecord(item)
    const step = typeof record.step === 'string' ? record.step.trim() : ''
    const status = record.status
    return step && isRuntimePlanStepStatus(status) ? [{ step, status }] : []
  })
  return steps.length > 0 ? steps : projectPlanSteps(content)
}

function projectPlanSteps(content: string): ClaudeAgentPlanSnapshot['steps'] {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(step => ({ step, status: 'pending' }))
}

function isRuntimePlanStepStatus(value: unknown): value is RuntimePlanStepStatus {
  return value === 'pending' || value === 'inProgress' || value === 'completed'
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
