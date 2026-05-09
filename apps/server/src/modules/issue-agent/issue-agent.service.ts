// Input: issue-agent store, chat runtime, and workflow rules service
// Output: issue-agent delegation semantics, background run orchestration, and activity projections
// Position: apps/server/src/modules/issue-agent/issue-agent.service.ts

import type { AgentActivity, AgentSession } from '@cradle/db'
import { inject, injectable } from 'tsyringe'

import { AppError } from '../../errors/app-error'
import { ChatRuntimeService } from '../chat-runtime/chat-runtime.service'
import { SessionService } from '../session/session.service'
import { WorkflowRulesService } from '../workflow-rules/workflow-rules.service'
import { IssueAgentStore } from './issue-agent.store'

interface ActiveAgentRun {
  runId: string
  chatSessionId: string
  aborted: boolean
}

interface IssueAgentSessionView extends AgentSession {
  isCurrentDelegation: boolean
}

@injectable()
export class IssueAgentService {
  private readonly activeRuns = new Map<string, ActiveAgentRun>()

  constructor(
    @inject(IssueAgentStore) private readonly store: IssueAgentStore,
    @inject(ChatRuntimeService) private readonly chatRuntime: ChatRuntimeService,
    @inject(SessionService) private readonly sessions: SessionService,
    @inject(WorkflowRulesService) private readonly workflowRules: WorkflowRulesService,
  ) {}

  getDelegation(issueId: string) {
    this.requireIssue(issueId)
    return this.store.getDelegationState(issueId)
  }

  listSessions(issueId: string): IssueAgentSessionView[] {
    this.requireIssue(issueId)
    const current = this.store.getDelegationState(issueId)
    return this.store.listAgentSessions(issueId).map(session => ({
      ...session,
      isCurrentDelegation: current.delegated && current.agentSessionId === session.id,
    }))
  }

  listActivities(agentSessionId: string): AgentActivity[] {
    this.requireAgentSession(agentSessionId)
    return this.store.listAgentActivities(agentSessionId)
  }

  async delegateIssue(input: { issueId: string, agentProfileId: string, agentId?: string }): Promise<IssueAgentSessionView> {
    this.requireIssue(input.issueId)
    const profile = this.requireAgentProfile(input.agentProfileId)
    if (!profile.enabled) {
      throw new AppError({
        code: 'issue_agent_profile_not_available',
        status: 409,
        message: 'Agent profile is disabled',
        details: { agentProfileId: input.agentProfileId },
      })
    }

    const session = this.store.createDelegationSession({
      issueId: input.issueId,
      agentProfileId: input.agentProfileId,
    })

    this.store.createActivity({
      agentSessionId: session.id,
      type: 'response',
      body: `Delegated to ${profile.name}`,
      signal: 'delegation.created',
      signalMetadata: { agentProfileId: input.agentProfileId, agentId: input.agentId ?? null },
    })

    void this.runSession(session.id, input.agentId)

    return {
      ...session,
      isCurrentDelegation: true,
    }
  }

  async rerunSession(input: { agentSessionId: string, agentId?: string }): Promise<IssueAgentSessionView> {
    const session = this.requireAgentSession(input.agentSessionId)
    if (this.activeRuns.has(session.id)) {
      throw new AppError({
        code: 'issue_agent_session_in_progress',
        status: 409,
        message: 'Issue agent session already has an active run',
        details: { agentSessionId: session.id },
      })
    }

    const refreshed = this.store.updateAgentSessionStatus(session.id, 'created') ?? session
    void this.runSession(session.id, input.agentId)

    return {
      ...refreshed,
      isCurrentDelegation: this.store.getDelegationState(session.issueId).agentSessionId === session.id,
    }
  }

  async undelegateIssue(issueId: string): Promise<void> {
    this.requireIssue(issueId)
    const state = this.store.getDelegationState(issueId)
    if (!state.delegated || !state.agentSessionId) {
      return
    }

    const activeRun = this.activeRuns.get(state.agentSessionId)
    if (activeRun) {
      activeRun.aborted = true
      await this.chatRuntime.abortRun(activeRun.runId)
      this.store.updateAgentSessionStatus(state.agentSessionId, 'stopped')
    }

    this.store.createActivity({
      agentSessionId: state.agentSessionId,
      type: 'response',
      body: 'Delegation removed',
      signal: 'delegation.removed',
    })
  }

  private async runSession(agentSessionId: string, agentId?: string): Promise<void> {
    const session = this.requireAgentSession(agentSessionId)
    const issue = this.requireIssue(session.issueId)
    const workflowRules = await this.workflowRules.get(issue.workspaceId, session.agentProfileId)
    const chatSession = this.sessions.create({
      workspaceId: issue.workspaceId,
      title: `Issue: ${issue.title}`,
      agentProfileId: session.agentProfileId,
      agentId: agentId ?? null,
      linkedIssueId: issue.id,
    })

    this.store.attachChatSession({ agentSessionId, chatSessionId: chatSession.id })
    this.store.updateAgentSessionStatus(agentSessionId, 'active')
    this.store.createActivity({
      agentSessionId,
      type: 'thought',
      body: 'Examining issue...',
      signal: 'run.started',
    })

    try {
      const run = await this.chatRuntime.createRun({
        sessionId: chatSession.id,
        text: buildIssuePrompt(issue, workflowRules),
      })

      this.activeRuns.set(agentSessionId, {
        runId: run.runId,
        chatSessionId: chatSession.id,
        aborted: false,
      })

      void this.watchRunCompletion(agentSessionId, run.runId)
    }
    catch (error) {
      this.store.updateAgentSessionStatus(agentSessionId, 'failed')
      this.store.createActivity({
        agentSessionId,
        type: 'error',
        body: error instanceof Error ? error.message : String(error),
        signal: 'run.failed',
      })
    }
  }

  private async watchRunCompletion(agentSessionId: string, runId: string): Promise<void> {
    while (true) {
      const run = this.store.getLatestRun(runId)
      if (!run) {
        this.activeRuns.delete(agentSessionId)
        this.store.updateAgentSessionStatus(agentSessionId, 'failed')
        this.store.createActivity({
          agentSessionId,
          type: 'error',
          body: 'Issue agent run disappeared before completion',
          signal: 'run.failed',
        })
        return
      }

      if (run.status === 'streaming') {
        await wait(25)
        continue
      }

      const tracked = this.activeRuns.get(agentSessionId)
      this.activeRuns.delete(agentSessionId)

      if (run.status === 'complete') {
        this.store.updateAgentSessionStatus(agentSessionId, 'completed')
        this.store.createActivity({
          agentSessionId,
          type: 'response',
          body: 'Completed work on issue',
          signal: 'run.completed',
        })
        return
      }

      if (run.status === 'failed') {
        this.store.updateAgentSessionStatus(agentSessionId, 'failed')
        this.store.createActivity({
          agentSessionId,
          type: 'error',
          body: run.errorText ?? 'Issue agent run failed',
          signal: 'run.failed',
        })
        return
      }

      this.store.updateAgentSessionStatus(agentSessionId, 'stopped')
      if (!tracked?.aborted) {
        this.store.createActivity({
          agentSessionId,
          type: 'response',
          body: 'Stopped by user',
          signal: 'run.aborted',
        })
      }
      return
    }
  }

  private requireIssue(issueId: string) {
    const issue = this.store.getIssue(issueId)
    if (!issue) {
      throw new AppError({
        code: 'issue_agent_issue_not_found',
        status: 404,
        message: 'Issue not found',
        details: { issueId },
      })
    }
    return issue
  }

  private requireAgentProfile(agentProfileId: string) {
    const profile = this.store.getAgentProfile(agentProfileId)
    if (!profile) {
      throw new AppError({
        code: 'issue_agent_profile_not_found',
        status: 404,
        message: 'Agent profile not found',
        details: { agentProfileId },
      })
    }
    return profile
  }

  private requireAgentSession(agentSessionId: string) {
    const session = this.store.getAgentSession(agentSessionId)
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
}

function buildIssuePrompt(issue: { title: string, description: string | null, priority: string, labels: string, contextRefs: string }, rules: { global: string | null, profileSpecific: string | null }): string {
  const parts = [`# Issue: ${issue.title}`, '']

  if (issue.description) {
    parts.push(issue.description, '')
  }

  parts.push(`Priority: ${issue.priority}`)

  const labels = parseStringArray(issue.labels)
  if (labels.length > 0) {
    parts.push(`Labels: ${labels.join(', ')}`)
  }

  const refs = parseContextRefs(issue.contextRefs)
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

  parts.push('', 'Please work on this issue. When done, summarize what you changed.')
  return parts.join('\n')
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  }
  catch {
    return []
  }
}

function parseContextRefs(raw: string): Array<{ type: string, value: string, label?: string }> {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((value): value is { type: string, value: string, label?: string } => {
          return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string' && typeof (value as { value?: unknown }).value === 'string'
        })
      : []
  }
  catch {
    return []
  }
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
