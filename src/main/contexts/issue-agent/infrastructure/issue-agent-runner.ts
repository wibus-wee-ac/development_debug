// Input: ChatEngine, domain event bus, issue-agent and Kanban DB tables, workflow rules
// Output: IssueAgentRunner for delegated issue execution and event-driven completion handling
// Position: Issue-agent context infrastructure runner bridging delegated issues with chat runtime

import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { getDb } from '../../../db'
import { agentActivities, agentSessions, kanbanIssueComments, kanbanIssues, workspaces } from '../../../db/schema'
import type { DomainEventBus } from '../../../events/domain-event-bus'
import type { ChatTurnFinishedDomainEvent } from '../../../events/domain-events'
import { ChatEngine } from '../../../lib/chat-engine'
import { getWorkflowRules } from '../../../lib/workflow-rules'

interface RunIssueInput {
  issueId: string
  agentSessionId: string
  agentProfileId: string
  agentId?: string
}

export class IssueAgentRunner {
  private static instance: IssueAgentRunner
  private readonly activeRuns = new Map<string, { chatSessionId: string, aborted: boolean }>()
  private turnFinishedUnsubscribe: (() => void) | null = null
  private eventBus: DomainEventBus | null = null

  static getInstance(): IssueAgentRunner {
    if (!IssueAgentRunner.instance) {
      IssueAgentRunner.instance = new IssueAgentRunner()
    }
    return IssueAgentRunner.instance
  }

  private constructor() {}

  bindDomainEventBus(eventBus: DomainEventBus): void {
    if (this.eventBus === eventBus) {
      return
    }
    if (this.turnFinishedUnsubscribe) {
      this.turnFinishedUnsubscribe()
      this.turnFinishedUnsubscribe = null
    }
    this.eventBus = eventBus
    this.turnFinishedUnsubscribe = eventBus.subscribe('chat.turn-finished', event => this.onTurnFinishedEvent(event))
  }

  async run(input: RunIssueInput): Promise<void> {
    const { issueId, agentSessionId, agentProfileId, agentId } = input
    const db = getDb()

    const issue = db.select().from(kanbanIssues).where(eq(kanbanIssues.id, issueId)).get()
    if (!issue) {
      throw new Error(`Issue ${issueId} not found`)
    }

    const workspace = db.select().from(workspaces).where(eq(workspaces.id, issue.workspaceId)).get()
    if (!workspace) {
      throw new Error(`Workspace ${issue.workspaceId} not found`)
    }

    const now = () => Math.floor(Date.now() / 1000)
    db.update(agentSessions)
      .set({ status: 'active', updatedAt: now() })
      .where(eq(agentSessions.id, agentSessionId))
      .run()

    this.addActivity(agentSessionId, 'thought', { body: 'Examining issue...' })

    const prompt = this.buildPrompt(issue, agentSessionId)

    const rules = await getWorkflowRules(issue.workspaceId, agentId)
    let fullText = prompt
    if (rules.global || rules.profileSpecific) {
      fullText += '\n\n---\n## Workflow Rules\n\n'
      if (rules.global) {
        fullText += `${rules.global}\n\n`
      }
      if (rules.profileSpecific) {
        fullText += `${rules.profileSpecific}\n`
      }
      fullText += '---'
    }

    try {
      const chatSessionId = await ChatEngine.getInstance().createAndSend({
        agentId: agentProfileId,
        workspaceId: issue.workspaceId,
        cwd: workspace.path,
        text: fullText,
        agentIdentityId: agentId,
      })

      db.update(agentSessions)
        .set({ chatSessionId, updatedAt: now() })
        .where(eq(agentSessions.id, agentSessionId))
        .run()

      this.activeRuns.set(agentSessionId, { chatSessionId, aborted: false })
    }
    catch (err) {
      db.update(agentSessions)
        .set({ status: 'failed', updatedAt: now() })
        .where(eq(agentSessions.id, agentSessionId))
        .run()

      const errorMsg = err instanceof Error ? err.message : String(err)
      this.addActivity(agentSessionId, 'error', { body: errorMsg }, issueId)

      throw err
    }
  }

  async stop(agentSessionId: string): Promise<void> {
    const db = getDb()
    const ts = Math.floor(Date.now() / 1000)
    const run = this.activeRuns.get(agentSessionId)

    if (run) {
      run.aborted = true
      try {
        await ChatEngine.getInstance().abort(run.chatSessionId)
      }
      catch {
        // Best-effort abort
      }
      this.activeRuns.delete(agentSessionId)
    }
    else {
      const session = db.select().from(agentSessions).where(eq(agentSessions.id, agentSessionId)).get()
      if (session?.chatSessionId) {
        try {
          await ChatEngine.getInstance().abort(session.chatSessionId)
        }
        catch {
          // Best-effort abort
        }
      }
    }

    db.update(agentSessions)
      .set({ status: 'stopped', updatedAt: ts })
      .where(eq(agentSessions.id, agentSessionId))
      .run()

    this.addActivity(agentSessionId, 'response', { body: 'Stopped by user' })
  }

  private buildPrompt(issue: typeof kanbanIssues.$inferSelect, agentSessionId: string): string {
    const parts: string[] = []

    parts.push(`# Issue: ${issue.title}`)
    parts.push('')

    if (issue.description) {
      parts.push(issue.description)
      parts.push('')
    }

    try {
      const refs = JSON.parse(issue.contextRefs ?? '[]') as Array<{ type: string, value: string, label?: string }>
      if (refs.length > 0) {
        parts.push('## Context')
        for (const ref of refs) {
          parts.push(`- [${ref.type}] ${ref.label ?? ref.value}`)
        }
        parts.push('')
      }
    }
    catch {
      // Ignore invalid JSON
    }

    try {
      const labels = JSON.parse(issue.labels) as string[]
      if (labels.length > 0) {
        parts.push(`Labels: ${labels.join(', ')}`)
      }
    }
    catch {
      // Ignore
    }

    parts.push(`Priority: ${issue.priority}`)
    parts.push('')

    const db = getDb()
    const priorSessions = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.issueId, issue.id))
      .all()
      .filter(s => s.id !== agentSessionId && (s.status === 'completed' || s.status === 'stopped' || s.status === 'failed'))

    if (priorSessions.length > 0) {
      parts.push('## Prior Agent Work')
      parts.push('This issue was previously worked on by other agents. Here is what they did:')
      parts.push('')
      for (const ps of priorSessions) {
        const activities = db
          .select()
          .from(agentActivities)
          .where(eq(agentActivities.agentSessionId, ps.id))
          .all()
          .filter(a => a.type === 'response' || a.type === 'error')

        const statusLabel = ps.status === 'completed' ? 'completed' : ps.status === 'stopped' ? 'stopped by user' : 'failed'
        parts.push(`- Session (${statusLabel}):`)
        for (const act of activities) {
          try {
            const content = JSON.parse(act.content) as { body?: string }
            if (content.body && content.body !== 'Stopped by user' && content.body !== 'Completed work on issue') {
              const excerpt = content.body.length > 200 ? `${content.body.slice(0, 200)}...` : content.body
              parts.push(`  ${excerpt}`)
            }
          }
          catch {
            // skip malformed
          }
        }
      }
      parts.push('')
    }

    parts.push('Please work on this issue. When done, summarize what you changed.')

    return parts.join('\n')
  }

  private addActivity(
    agentSessionId: string,
    type: 'thought' | 'action' | 'response' | 'elicitation' | 'error' | 'prompt',
    content: Record<string, unknown>,
    issueId?: string,
  ): void {
    const db = getDb()
    const now = Math.floor(Date.now() / 1000)

    db.insert(agentActivities).values({
      id: randomUUID(),
      agentSessionId,
      type,
      content: JSON.stringify(content),
      createdAt: now,
    }).run()

    if (issueId && (type === 'response' || type === 'error')) {
      const body = (content as { body?: string }).body ?? JSON.stringify(content)
      db.insert(kanbanIssueComments).values({
        id: randomUUID(),
        issueId,
        content: body,
        authorKind: 'agent',
        authorId: null,
        createdAt: now,
      }).run()
    }
  }

  private onTurnFinishedEvent(event: ChatTurnFinishedDomainEvent): void {
    const payload = event.payload
    const db = getDb()
    const matchingRun = [...this.activeRuns.entries()].find(([, run]) => run.chatSessionId === payload.chatSessionId)
    const fallbackSession = matchingRun
      ? null
      : db
          .select()
          .from(agentSessions)
          .where(eq(agentSessions.chatSessionId, payload.chatSessionId))
          .get()

    const agentSessionId = matchingRun?.[0] ?? fallbackSession?.id
    if (!agentSessionId) {
      return
    }

    const run = matchingRun?.[1]
    if (matchingRun) {
      this.activeRuns.delete(agentSessionId)
    }
    if (run?.aborted) {
      return
    }

    const agentSession = fallbackSession
      ?? db.select().from(agentSessions).where(eq(agentSessions.id, agentSessionId)).get()
    if (!agentSession) {
      return
    }
    if (agentSession.status === 'stopped') {
      return
    }

    const ts = Math.floor(Date.now() / 1000)
    const nextStatus = payload.status === 'failed'
      ? 'failed'
      : payload.status === 'aborted'
        ? 'stopped'
        : 'completed'
    db.update(agentSessions)
      .set({ status: nextStatus, updatedAt: ts })
      .where(eq(agentSessions.id, agentSessionId))
      .run()

    if (payload.status === 'failed') {
      this.addActivity(
        agentSessionId,
        'error',
        { body: payload.errorText ?? 'Agent turn failed' },
        agentSession.issueId,
      )
      return
    }

    const completionLabel = payload.status === 'aborted'
      ? 'Stopped by user'
      : 'Completed work on issue'
    this.addActivity(agentSessionId, 'response', { body: completionLabel }, agentSession.issueId)
  }
}
