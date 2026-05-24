import { randomUUID } from 'node:crypto'

import type { Agent, AgentActivity, AgentSession } from '@cradle/db'
import {
  agentActivities,
  agents,
  agentSessions,
  providerTargets,
} from '@cradle/db'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import * as ChatRuntime from '../chat-runtime/service'
import * as Issue from '../issue/service'
import * as Session from '../session/service'
import * as WorkflowRules from '../workflow-rules/service'

// ── types ──

interface ActiveAgentRun {
  runId: string
  chatSessionId: string
  aborted: boolean
}

interface IssueAgentSessionView extends AgentSession {
  isCurrentDelegation: boolean
}

interface IssueAgentDelegationState {
  issueId: string
  delegated: boolean
  providerTargetId: string | null
  agentId: string | null
  agentSessionId: string | null
  chatSessionId: string | null
}

// ── in-memory state ──

const activeRuns = new Map<string, ActiveAgentRun>()
const continuationWatchers = new Map<string, Promise<void>>()

const AgentActivityInputSchema = z.object({
  agentSessionId: z.string(),
  type: z.custom<AgentActivity['type']>(),
  body: z.string(),
  signal: z.string().nullable().default(null),
  signalMetadata: z.record(z.string(), z.unknown()).nullable().optional(),
})

// ── DB queries (merged from store) ──

function getProviderTarget(providerTargetId: string) {
  return db()
    .select({ id: providerTargets.id, name: providerTargets.displayName, enabled: providerTargets.enabled })
    .from(providerTargets)
    .where(eq(providerTargets.id, providerTargetId))
    .get()
}

function getAgentSession(agentSessionId: string): AgentSession | undefined {
  return db().select().from(agentSessions).where(eq(agentSessions.id, agentSessionId)).get()
}

function listAgentSessions(issueId: string): AgentSession[] {
  return db().select().from(agentSessions).where(eq(agentSessions.issueId, issueId)).orderBy(desc(agentSessions.createdAt)).all()
}

function listAgentActivities(agentSessionId: string): AgentActivity[] {
  return db().select().from(agentActivities).where(eq(agentActivities.agentSessionId, agentSessionId)).orderBy(agentActivities.createdAt).all()
}

function createDelegationSession(input: { issueId: string, providerTargetId: string, agentId: string }): AgentSession {
  const now = currentUnixSeconds()
  return db().insert(agentSessions).values({
    id: randomUUID(),
    issueId: input.issueId,
    providerTargetId: input.providerTargetId,
    agentId: input.agentId,
    chatSessionId: null,
    status: 'created',
    createdAt: now,
    updatedAt: now,
  }).returning().get()
}

function attachChatSession(input: { agentSessionId: string, chatSessionId: string }): AgentSession | undefined {
  db().update(agentSessions).set({
    chatSessionId: input.chatSessionId,
    updatedAt: currentUnixSeconds(),
  }).where(eq(agentSessions.id, input.agentSessionId)).run()
  return getAgentSession(input.agentSessionId)
}

function updateAgentSessionStatus(agentSessionId: string, status: AgentSession['status']): AgentSession | undefined {
  db().update(agentSessions).set({ status, updatedAt: currentUnixSeconds() }).where(eq(agentSessions.id, agentSessionId)).run()
  return getAgentSession(agentSessionId)
}

function createActivity(rawInput: {
  agentSessionId: string
  type: AgentActivity['type']
  body: string
  signal?: string | null
  signalMetadata?: Record<string, unknown> | null
}): AgentActivity {
  const input = AgentActivityInputSchema.parse(rawInput)
  return db().insert(agentActivities).values({
    id: randomUUID(),
    agentSessionId: input.agentSessionId,
    type: input.type,
    content: JSON.stringify({ body: input.body }),
    signal: input.signal,
    signalMetadata: input.signalMetadata ? JSON.stringify(input.signalMetadata) : null,
    createdAt: currentUnixSeconds(),
  }).returning().get()
}

// ── require helpers ──

function requireIssue(issueId: string) {
  try {
    return Issue.getIssue(issueId)
  }
  catch {
    throw new AppError({
      code: 'issue_agent_issue_not_found',
      status: 404,
      message: 'Issue not found',
      details: { issueId },
    })
  }
}

function requireProviderTarget(providerTargetId: string) {
  const target = getProviderTarget(providerTargetId)
  if (!target) {
    throw new AppError({
      code: 'issue_agent_provider_target_not_found',
      status: 404,
      message: 'Provider target not found',
      details: { providerTargetId },
    })
  }
  return target
}

function requireDelegationAgent(agentId: string): Agent & { providerTargetId: string } {
  const agent = db().select().from(agents).where(eq(agents.id, agentId)).get()
  if (!agent) {
    throw new AppError({
      code: 'issue_agent_agent_not_found',
      status: 404,
      message: 'Agent not found',
      details: { agentId },
    })
  }
  if (!agent.enabled) {
    throw new AppError({
      code: 'issue_agent_agent_not_available',
      status: 409,
      message: 'Agent is disabled',
      details: { agentId },
    })
  }
  if (!agent.providerTargetId) {
    throw new AppError({
      code: 'issue_agent_agent_not_supported',
      status: 409,
      message: 'Issue delegation requires a provider-backed agent',
      details: { agentId, runtimeKind: agent.runtimeKind },
    })
  }

  return {
    ...agent,
    providerTargetId: agent.providerTargetId,
  }
}

function requireAgentSession(agentSessionId: string) {
  const session = getAgentSession(agentSessionId)
  if (!session) {
    throw new AppError({
      code: 'issue_agent_session_not_found',
      status: 404,
      message: 'Issue agent session not found',
      details: { agentSessionId },
    })
  }
  return session
}

// ── prompt builder ──

function buildIssuePrompt(
  issue: { id: string, title: string, description: string | null, priority: string, labels: string[], contextRefs: string },
  rules: { global: string | null, profileSpecific: string | null },
): string {
  const parts = [`# Issue: ${issue.title}`, '', `Issue ID: ${issue.id}`, '']

  if (issue.description) {
    parts.push(issue.description, '')
  }

  parts.push(`Priority: ${issue.priority}`)

  if (issue.labels.length > 0) {
    parts.push(`Labels: ${issue.labels.join(', ')}`)
  }

  const refs = Issue.IssuePromptContextRefsJsonSchema.parse(issue.contextRefs)
  if (refs.length > 0) {
    parts.push('', '## Context')
    refs.forEach((ref) => {
      parts.push(`- [${ref.type}] ${ref.label ?? ref.value}`)
    })
  }

  if (rules.global || rules.profileSpecific) {
    parts.push('', '## Workflow Rules')
    if (rules.global) {
      parts.push(rules.global)
    }
    if (rules.profileSpecific) {
      parts.push(rules.profileSpecific)
    }
  }

  parts.push('', 'Please work on this issue. When done, summarize what you changed. Send the summary as a comment on the issue. If you need to ask for more information, send a comment.')
  return parts.join('\n')
}

// ── background run watcher ──

async function watchRunCompletion(agentSessionId: string, runId: string): Promise<void> {
  try {
    const run = await ChatRuntime.waitForRunCompletion(runId)
    const tracked = activeRuns.get(agentSessionId)
    activeRuns.delete(agentSessionId)

    if (run.status === 'complete') {
      if (tracked?.chatSessionId && hasQueuedContinuationWork(tracked.chatSessionId)) {
        startContinuationWatcher({
          agentSessionId,
          chatSessionId: tracked.chatSessionId,
          since: currentUnixSeconds(),
        })
        return
      }
      updateAgentSessionStatus(agentSessionId, 'completed')
      createActivity({
        agentSessionId,
        type: 'response',
        body: 'Completed work on issue',
        signal: 'run.completed',
      })
      return
    }

    if (run.status === 'failed') {
      updateAgentSessionStatus(agentSessionId, 'failed')
      createActivity({
        agentSessionId,
        type: 'error',
        body: run.errorText ?? 'Issue agent run failed',
        signal: 'run.failed',
      })
      return
    }

    updateAgentSessionStatus(agentSessionId, 'stopped')
    if (!tracked?.aborted) {
      createActivity({
        agentSessionId,
        type: 'response',
        body: 'Stopped by user',
        signal: 'run.aborted',
      })
    }
  }
  catch (error) {
    activeRuns.delete(agentSessionId)
    updateAgentSessionStatus(agentSessionId, 'failed')
    createActivity({
      agentSessionId,
      type: 'error',
      body: error instanceof Error ? error.message : 'Issue agent run disappeared before completion',
      signal: 'run.failed',
    })
  }
}

function hasQueuedContinuationWork(chatSessionId: string): boolean {
  return ChatRuntime.listSessionQueueItems(chatSessionId)
    .some(item => item.status === 'pending' || item.status === 'running')
}

function hasChatSessionContinuationWork(chatSessionId: string): boolean {
  const hasActiveRun = ChatRuntime.listActiveRunSummaries()
    .some(run => run.sessionId === chatSessionId)
  if (hasActiveRun) {
    return true
  }
  return hasQueuedContinuationWork(chatSessionId)
}

function startContinuationWatcher(input: {
  agentSessionId: string
  chatSessionId: string
  since: number
}): void {
  if (continuationWatchers.has(input.agentSessionId)) {
    return
  }

  const watcher = watchContinuationWork(input)
  continuationWatchers.set(input.agentSessionId, watcher)
  void watcher.finally(() => {
    continuationWatchers.delete(input.agentSessionId)
  })
}

async function watchContinuationWork(input: {
  agentSessionId: string
  chatSessionId: string
  since: number
}): Promise<void> {
  try {
    updateAgentSessionStatus(input.agentSessionId, 'active')
    while (hasChatSessionContinuationWork(input.chatSessionId)) {
      await delay(500)
    }

    const session = getAgentSession(input.agentSessionId)
    if (!session || session.status === 'stopped') {
      return
    }

    const queueItems = ChatRuntime.listSessionQueueItems(input.chatSessionId)
      .filter(item => item.createdAt >= input.since)
    const failedItem = queueItems.find(item => item.status === 'failed')
    if (failedItem) {
      updateAgentSessionStatus(input.agentSessionId, 'failed')
      createActivity({
        agentSessionId: input.agentSessionId,
        type: 'error',
        body: failedItem.errorText ?? 'Continuation failed',
        signal: 'continuation.failed',
        signalMetadata: {
          chatSessionId: input.chatSessionId,
          queueItemId: failedItem.id,
        },
      })
      return
    }

    updateAgentSessionStatus(input.agentSessionId, 'completed')
    createActivity({
      agentSessionId: input.agentSessionId,
      type: 'response',
      body: 'Completed queued continuation',
      signal: 'continuation.completed',
      signalMetadata: { chatSessionId: input.chatSessionId },
    })
  }
  catch (error) {
    updateAgentSessionStatus(input.agentSessionId, 'failed')
    createActivity({
      agentSessionId: input.agentSessionId,
      type: 'error',
      body: error instanceof Error ? error.message : 'Continuation watcher failed',
      signal: 'continuation.failed',
      signalMetadata: { chatSessionId: input.chatSessionId },
    })
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function cancelChatSessionContinuationWork(chatSessionId: string): Promise<void> {
  await ChatRuntime.cancelSession(chatSessionId)
  const queueItems = ChatRuntime.listSessionQueueItems(chatSessionId)
  for (const item of queueItems) {
    if (item.status !== 'pending') {
      continue
    }
    try {
      ChatRuntime.cancelSessionQueueItem(chatSessionId, item.id)
    }
    catch {
      // The queue item may have been claimed by the runtime between list and cancel.
    }
  }
}

// ── run session ──

async function runSession(agentSessionId: string): Promise<void> {
  try {
    const session = requireAgentSession(agentSessionId)
    if (!session.agentId) {
      throw new AppError({
        code: 'issue_agent_missing_agent_identity',
        status: 409,
        message: 'Issue agent session is missing agent identity',
        details: { agentSessionId },
      })
    }

    const issue = requireIssue(session.issueId)
    const workflowRules = await WorkflowRules.get(issue.workspaceId, session.providerTargetId)
    const chatSession = Session.create({
      workspaceId: issue.workspaceId,
      title: `Issue: ${issue.title}`,
      providerTargetId: session.providerTargetId,
      agentId: session.agentId,
      linkedIssueId: issue.id,
      configJson: JSON.stringify({ permissionMode: 'bypassPermissions' }),
    })

    attachChatSession({ agentSessionId, chatSessionId: chatSession.id })
    updateAgentSessionStatus(agentSessionId, 'active')
    createActivity({
      agentSessionId,
      type: 'thought',
      body: 'Examining issue...',
      signal: 'run.started',
    })

    const run = await ChatRuntime.createRun({
      sessionId: chatSession.id,
      text: buildIssuePrompt(issue, workflowRules),
    })

    activeRuns.set(agentSessionId, {
      runId: run.runId,
      chatSessionId: chatSession.id,
      aborted: false,
    })

    void watchRunCompletion(agentSessionId, run.runId)
  }
  catch (error) {
    updateAgentSessionStatus(agentSessionId, 'failed')
    createActivity({
      agentSessionId,
      type: 'error',
      body: error instanceof Error ? error.message : String(error),
      signal: 'run.failed',
    })
  }
}

// ── public API ──

export function getDelegation(issueId: string): IssueAgentDelegationState {
  requireIssue(issueId)
  const latestSession = listAgentSessions(issueId)[0]
  if (!latestSession) {
    return { issueId, delegated: false, providerTargetId: null, agentId: null, agentSessionId: null, chatSessionId: null }
  }

  const latestActivity = listAgentActivities(latestSession.id).at(-1)
  if (latestActivity?.signal === 'delegation.removed') {
    return { issueId, delegated: false, providerTargetId: null, agentId: null, agentSessionId: null, chatSessionId: null }
  }

  return {
    issueId,
    delegated: true,
    providerTargetId: latestSession.providerTargetId,
    agentId: latestSession.agentId,
    agentSessionId: latestSession.id,
    chatSessionId: latestSession.chatSessionId,
  }
}

export function listSessions(issueId: string): IssueAgentSessionView[] {
  requireIssue(issueId)
  const current = getDelegation(issueId)
  return listAgentSessions(issueId).map(session => ({
    ...session,
    isCurrentDelegation: current.delegated && current.agentSessionId === session.id,
  }))
}

export function listActivities(agentSessionId: string): AgentActivity[] {
  requireAgentSession(agentSessionId)
  return listAgentActivities(agentSessionId)
}

export async function enqueueContinuation(input: {
  agentSessionId: string
  mode: ChatRuntime.ChatSessionQueueMode
  text: string
}): Promise<{
  ok: true
  chatSessionId: string
  queueItemId: string
  mode: ChatRuntime.ChatSessionQueueMode
}> {
  const session = requireAgentSession(input.agentSessionId)
  const text = input.text.trim()
  if (!text) {
    throw new AppError({
      code: 'issue_agent_prompt_empty',
      status: 400,
      message: 'Issue agent continuation requires text',
      details: { agentSessionId: input.agentSessionId },
    })
  }
  if (!session.chatSessionId) {
    throw new AppError({
      code: 'issue_agent_chat_session_not_ready',
      status: 409,
      message: 'Issue agent chat session is not ready',
      details: { agentSessionId: input.agentSessionId },
    })
  }

  const queueItem = await ChatRuntime.enqueueSessionQueueItem({
    sessionId: session.chatSessionId,
    mode: input.mode,
    text,
  })

  createActivity({
    agentSessionId: session.id,
    type: 'prompt',
    body: text,
    signal: input.mode === 'steer' ? 'continuation.steer' : 'continuation.queued',
    signalMetadata: {
      chatSessionId: session.chatSessionId,
      queueItemId: queueItem.id,
      mode: input.mode,
    },
  })

  if (queueItem.status !== 'completed') {
    startContinuationWatcher({
      agentSessionId: session.id,
      chatSessionId: session.chatSessionId,
      since: queueItem.createdAt,
    })
  }

  return {
    ok: true,
    chatSessionId: session.chatSessionId,
    queueItemId: queueItem.id,
    mode: input.mode,
  }
}

export async function delegateIssue(input: { issueId: string, agentId: string, providerTargetId?: string | null }): Promise<IssueAgentSessionView> {
  requireIssue(input.issueId)
  const agent = requireDelegationAgent(input.agentId)
  if (input.providerTargetId && input.providerTargetId !== agent.providerTargetId) {
    throw new AppError({
      code: 'issue_agent_identity_mismatch',
      status: 400,
      message: 'Provider target does not match the selected agent',
      details: { agentId: input.agentId, providerTargetId: input.providerTargetId, expectedProviderTargetId: agent.providerTargetId },
    })
  }

  const target = requireProviderTarget(agent.providerTargetId)
  if (!target.enabled) {
    throw new AppError({
      code: 'issue_agent_provider_target_not_available',
      status: 409,
      message: 'Provider target is disabled',
      details: { providerTargetId: agent.providerTargetId },
    })
  }

  Issue.updateIssueDelegation(input.issueId, { agentId: agent.id, providerTargetId: agent.providerTargetId })

  // Add system comment to activity timeline
  Issue.addComment({ issueId: input.issueId, content: `Delegated to ${agent.name}`, authorKind: 'system.delegated' })

  const session = createDelegationSession({
    issueId: input.issueId,
    providerTargetId: agent.providerTargetId,
    agentId: agent.id,
  })

  createActivity({
    agentSessionId: session.id,
    type: 'response',
    body: `Delegated to ${agent.name}`,
    signal: 'delegation.created',
    signalMetadata: { providerTargetId: agent.providerTargetId, agentId: agent.id },
  })

  void runSession(session.id)

  return { ...session, isCurrentDelegation: true }
}

export async function rerunSession(input: { agentSessionId: string }): Promise<IssueAgentSessionView> {
  const session = requireAgentSession(input.agentSessionId)
  if (activeRuns.has(session.id)) {
    throw new AppError({
      code: 'issue_agent_session_in_progress',
      status: 409,
      message: 'Issue agent session already has an active run',
      details: { agentSessionId: session.id },
    })
  }

  const refreshed = updateAgentSessionStatus(session.id, 'created') ?? session
  void runSession(session.id)

  const delegation = getDelegation(session.issueId)
  return { ...refreshed, isCurrentDelegation: delegation.agentSessionId === session.id }
}

export async function undelegateIssue(issueId: string): Promise<void> {
  requireIssue(issueId)
  const state = getDelegation(issueId)
  if (!state.delegated || !state.agentSessionId) {
    return
  }

  const run = activeRuns.get(state.agentSessionId)
  if (run) {
    run.aborted = true
    await cancelChatSessionContinuationWork(run.chatSessionId)
    updateAgentSessionStatus(state.agentSessionId, 'stopped')
  }
  else if (state.chatSessionId) {
    await cancelChatSessionContinuationWork(state.chatSessionId)
    updateAgentSessionStatus(state.agentSessionId, 'stopped')
  }

  Issue.updateIssueDelegation(issueId, null)

  // Add system comment to activity timeline
  Issue.addComment({ issueId, content: 'Delegation removed', authorKind: 'system.undelegated' })

  createActivity({
    agentSessionId: state.agentSessionId,
    type: 'response',
    body: 'Delegation removed',
    signal: 'delegation.removed',
  })
}

export async function stopSession(agentSessionId: string): Promise<void> {
  const session = requireAgentSession(agentSessionId)
  const run = activeRuns.get(agentSessionId)
  if (run) {
    run.aborted = true
    await cancelChatSessionContinuationWork(run.chatSessionId)
  }
  else if (session.chatSessionId) {
    await cancelChatSessionContinuationWork(session.chatSessionId)
  }
  updateAgentSessionStatus(agentSessionId, 'stopped')
  createActivity({
    agentSessionId,
    type: 'response',
    body: 'Session stopped by user',
    signal: 'run.aborted',
  })
}
