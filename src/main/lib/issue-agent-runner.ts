// Input: ChatEngine, KanbanService DB access, agent session/activity tables
// Output: IssueAgentRunner — orchestrates agent execution when an issue is delegated
// Position: Main-process L2 service bridging kanban delegation with chat engine

import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { getDb } from '../db'
import { agentActivities, agentSessions, kanbanIssueComments, kanbanIssues, workspaces } from '../db/schema'
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

    // Build prompt from issue context
    const prompt = this.buildPrompt(issue)

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

      // Monitor chat session completion
      this.monitorCompletion(agentSessionId, chatSessionId, issueId)
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
   */
  async stop(agentSessionId: string): Promise<void> {
    const run = this.activeRuns.get(agentSessionId)
    if (!run) {
      return
    }

    run.aborted = true

    try {
      await ChatEngine.getInstance().abort(run.chatSessionId)
    }
    catch {
      // Best-effort abort
    }

    const ts = Math.floor(Date.now() / 1000)
    getDb().update(agentSessions).set({ status: 'stopped', updatedAt: ts }).where(eq(agentSessions.id, agentSessionId)).run()

    this.addActivity(agentSessionId, 'response', { body: 'Stopped by user' })
    this.activeRuns.delete(agentSessionId)
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private buildPrompt(issue: typeof kanbanIssues.$inferSelect): string {
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

  private monitorCompletion(agentSessionId: string, chatSessionId: string, issueId: string): void {
    // Poll for chat session completion by checking if the draft is still active
    // This is a simplified approach — a production system would use event subscription
    const checkInterval = setInterval(() => {
      const run = this.activeRuns.get(agentSessionId)
      if (!run || run.aborted) {
        clearInterval(checkInterval)
        return
      }

      // Check if ChatEngine still has an active draft for this session
      const engine = ChatEngine.getInstance()
      if (!engine.hasDraft(chatSessionId)) {
        clearInterval(checkInterval)
        this.activeRuns.delete(agentSessionId)

        const now = Math.floor(Date.now() / 1000)
        getDb().update(agentSessions).set({ status: 'completed', updatedAt: now }).where(eq(agentSessions.id, agentSessionId)).run()

        this.addActivity(agentSessionId, 'response', { body: 'Completed work on issue' }, issueId)
      }
    }, 2000) // Check every 2 seconds
  }
}
