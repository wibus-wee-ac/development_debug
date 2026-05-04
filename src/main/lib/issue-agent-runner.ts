// Input: ChatEngine, KanbanService DB access, agent session/activity tables
// Output: IssueAgentRunner — orchestrates agent execution when an issue is delegated
// Position: Main-process L2 service bridging kanban delegation with chat engine

import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { getDb } from '../db'
import { agentActivities, agentSessions, kanbanIssueComments, kanbanIssues, workspaces } from '../db/schema'
import type { ChatTurnFinishedEvent } from './chat-engine'
import { ChatEngine } from './chat-engine'
import { getWorkflowRules } from './workflow-rules'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RunIssueInput {
  issueId: string
  agentSessionId: string
  agentProfileId: string
  agentId?: string
}

// ── Runner ────────────────────────────────────────────────────────────────────

export class IssueAgentRunner {
  private static instance: IssueAgentRunner
  /** Tracks in-flight runs by agentSessionId. */
  private readonly activeRuns = new Map<string, { chatSessionId: string, aborted: boolean }>()

  static getInstance(): IssueAgentRunner {
    if (!IssueAgentRunner.instance) {
      IssueAgentRunner.instance = new IssueAgentRunner()
    }
    return IssueAgentRunner.instance
  }

  private constructor() {
    ChatEngine.getInstance().onTurnFinished(event => this.onTurnFinished(event))
  }

  /**
   * Start agent execution for a delegated issue.
   * Called after KanbanService.delegateIssue creates the agent session.
   */
  async run(input: RunIssueInput): Promise<void> {
    const { issueId, agentSessionId, agentProfileId, agentId } = input
    const db = getDb()

    // Load issue
    const issue = db.select().from(kanbanIssues).where(eq(kanbanIssues.id, issueId)).get()
    if (!issue) {
      throw new Error(`Issue ${issueId} not found`)
    }

    // Load workspace for cwd
    const workspace = db.select().from(workspaces).where(eq(workspaces.id, issue.workspaceId)).get()
    if (!workspace) {
      throw new Error(`Workspace ${issue.workspaceId} not found`)
    }

    // Mark agent session active
    const now = () => Math.floor(Date.now() / 1000)
    db.update(agentSessions)
      .set({ status: 'active', updatedAt: now() })
      .where(eq(agentSessions.id, agentSessionId))
      .run()

    // Emit immediate "thinking" activity (must be within 10s per AIG)
    this.addActivity(agentSessionId, 'thought', { body: 'Examining issue...' })

    // Build prompt from issue context (including prior session summaries)
    const prompt = this.buildPrompt(issue, agentSessionId)

    // Inject workflow rules as additional user message content
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

    // Create chat session via ChatEngine
    try {
      const chatSessionId = await ChatEngine.getInstance().createAndSend({
        agentId: agentProfileId,
        workspaceId: issue.workspaceId,
        cwd: workspace.path,
        text: fullText,
        agentIdentityId: agentId,
      })

      // Link chat session to agent session
      db.update(agentSessions)
        .set({ chatSessionId, updatedAt: now() })
        .where(eq(agentSessions.id, agentSessionId))
        .run()

      this.activeRuns.set(agentSessionId, { chatSessionId, aborted: false })
    }
    catch (err) {
      // Mark session failed
      db.update(agentSessions)
        .set({ status: 'failed', updatedAt: now() })
        .where(eq(agentSessions.id, agentSessionId))
        .run()

      const errorMsg = err instanceof Error ? err.message : String(err)
      this.addActivity(agentSessionId, 'error', { body: errorMsg }, issueId)

      throw err
    }
  }

  /**
   * Stop a running agent session.
   * Works even if the in-memory activeRuns map has lost the entry (e.g. after restart).
   */
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
      // Fallback: look up the linked chat session from DB and abort it
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

    // Always update DB status
    db.update(agentSessions)
      .set({ status: 'stopped', updatedAt: ts })
      .where(eq(agentSessions.id, agentSessionId))
      .run()

    this.addActivity(agentSessionId, 'response', { body: 'Stopped by user' })
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private buildPrompt(issue: typeof kanbanIssues.$inferSelect, agentSessionId: string): string {
    const parts: string[] = []

    parts.push(`# Issue: ${issue.title}`)
    parts.push('')

    if (issue.description) {
      parts.push(issue.description)
      parts.push('')
    }

    // Parse context refs
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

    // Parse labels
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

    // Include prior agent session summaries for re-delegation context
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
        // Get response/error activities from this session
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

    // Project response/error activities to comments
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

  private onTurnFinished(event: ChatTurnFinishedEvent): void {
    const db = getDb()
    const matchingRun = [...this.activeRuns.entries()].find(([, run]) => run.chatSessionId === event.chatSessionId)
    if (!matchingRun) {
      return
    }

    const [agentSessionId, run] = matchingRun
    this.activeRuns.delete(agentSessionId)
    if (run.aborted) {
      return
    }

    const agentSession = db.select().from(agentSessions).where(eq(agentSessions.id, agentSessionId)).get()
    if (!agentSession) {
      return
    }

    const ts = Math.floor(Date.now() / 1000)
    const nextStatus = event.status === 'failed' ? 'failed' : 'completed'
    db.update(agentSessions)
      .set({ status: nextStatus, updatedAt: ts })
      .where(eq(agentSessions.id, agentSessionId))
      .run()

    if (event.status === 'failed') {
      this.addActivity(
        agentSessionId,
        'error',
        { body: event.errorText ?? 'Agent turn failed' },
        agentSession.issueId,
      )
      return
    }

    const completionLabel = event.status === 'aborted'
      ? 'Stopped by user'
      : 'Completed work on issue'
    this.addActivity(agentSessionId, 'response', { body: completionLabel }, agentSession.issueId)
  }
}
