/**
 * Output: Claude Agent provider snapshot projections for session-local runtime state.
 * Input: workspace provider snapshots and requested model ids.
 * Position: Claude Agent provider package owner for providerStateSnapshot updates.
 */

import type { RuntimePlanStepStatus, RuntimePlanUiSlotState, RuntimeProgressUiSlotState, RuntimeSession } from '../../chat-runtime/runtime-provider-types'
import { readObjectRecord as readRecord } from '../../../helpers/json-record'
import type { ClaudeAgentCapturedPlan, ClaudeAgentCapturedTodos } from './event-to-chunk-mapper'
import type { TodoPluginItem, TodoPluginStatus } from './tools/todo-plugin-state'
import type { WorkspaceProviderStateSnapshot } from '../provider-state-snapshot'
import { readWorkspaceProviderStateSnapshot } from '../provider-state-snapshot'

interface ClaudeAgentPlanSnapshot {
  threadId: string
  turnId: string
  content: string
  steps: Array<{ step: string, status: RuntimePlanStepStatus }>
  updatedAt: number
}

interface ClaudeAgentProgressSnapshot {
  threadId: string
  turnId: string
  source: string
  items: TodoPluginItem[]
  updatedAt: number
}

export const CLAUDE_AGENT_RUNTIME_DEFAULT_MODEL_SWITCH_ID = '__cradle_claude_runtime_default__'

export function resolveClaudeAgentPendingModelSwitchId(snapshot: WorkspaceProviderStateSnapshot, requestedModelId: string | null): string | null {
  const existingPendingModelSwitchId = readClaudeAgentPendingModelSwitchId(snapshot)
  if (requestedModelId === null) {
    return snapshot.models.currentModelId === null ? null : CLAUDE_AGENT_RUNTIME_DEFAULT_MODEL_SWITCH_ID
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

export function clearClaudeAgentProgress(runtimeSession: RuntimeSession): void {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  const claudeAgentState = { ...readRecord(snapshot.claudeAgent) }
  delete claudeAgentState.progress

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

export function writeClaudeAgentProgress(runtimeSession: RuntimeSession, progress: ClaudeAgentCapturedTodos, updatedAt: number = Date.now()): void {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  const claudeAgentState = {
    ...readRecord(snapshot.claudeAgent),
    progress: {
      threadId: runtimeSession.chatSessionId,
      turnId: progress.toolCallId,
      source: progress.source ?? 'TodoWrite',
      items: progress.todos,
      updatedAt,
    } satisfies ClaudeAgentProgressSnapshot,
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

export function projectClaudeAgentProgressUiSlotState(runtimeSession: RuntimeSession): RuntimeProgressUiSlotState | null {
  const snapshot = readWorkspaceProviderStateSnapshot(runtimeSession.providerStateSnapshot)
  const progress = readClaudeAgentProgressSnapshot(snapshot)
  if (!progress || progress.threadId !== runtimeSession.chatSessionId) {
    return null
  }
  const items = progress.items.map(item => ({
    id: item.id,
    label: item.content,
    status: mapTodoPluginStatusToRuntimeStatus(item.status),
    sourceStatus: item.sourceStatus,
  }))
  const pendingCount = items.filter(item => item.status === 'pending').length
  const inProgressCount = items.filter(item => item.status === 'inProgress').length
  const completedCount = items.filter(item => item.status === 'completed').length
  return {
    kind: 'progress',
    slotId: 'claude-agent:progress',
    threadId: progress.threadId,
    turnId: progress.turnId,
    source: progress.source,
    items,
    currentItem: items.find(item => item.status === 'inProgress')?.label
      ?? items.find(item => item.status === 'pending')?.label
      ?? null,
    pendingCount,
    inProgressCount,
    completedCount,
    updatedAt: progress.updatedAt,
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

function readClaudeAgentProgressSnapshot(snapshot: WorkspaceProviderStateSnapshot): ClaudeAgentProgressSnapshot | null {
  const progress = readRecord(readRecord(snapshot.claudeAgent).progress)
  const threadId = typeof progress.threadId === 'string' ? progress.threadId : ''
  const turnId = typeof progress.turnId === 'string' ? progress.turnId : ''
  const source = typeof progress.source === 'string' ? progress.source.trim() : ''
  const updatedAt = typeof progress.updatedAt === 'number' ? progress.updatedAt : 0
  const items = readClaudeAgentProgressItems(progress.items)
  if (!threadId || !turnId || !source || items.length === 0 || updatedAt <= 0) {
    return null
  }
  return {
    threadId,
    turnId,
    source,
    items,
    updatedAt,
  }
}

function readClaudeAgentProgressItems(value: unknown): TodoPluginItem[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item): TodoPluginItem[] => {
    const record = readRecord(item)
    const content = typeof record.content === 'string' ? record.content.trim() : ''
    const status = record.status
    if (!content || !isTodoPluginStatus(status)) {
      return []
    }
    return [{
      id: typeof record.id === 'string' ? record.id : null,
      content,
      status,
      sourceStatus: typeof record.sourceStatus === 'string' ? record.sourceStatus : null,
    }]
  })
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

function isTodoPluginStatus(value: unknown): value is TodoPluginStatus {
  return value === 'todo' || value === 'processing' || value === 'completed'
}

function mapTodoPluginStatusToRuntimeStatus(status: TodoPluginStatus): RuntimePlanStepStatus {
  switch (status) {
    case 'completed':
      return 'completed'
    case 'processing':
      return 'inProgress'
    case 'todo':
    default:
      return 'pending'
  }
}
