// Input: Chat runtime port, issue/agent tables, and workflow rules
// Output: Issue-agent runtime factory for delegated issue execution and completion handling
// Position: Issue-agent feature runtime boundary between delegation commands and chat completion events

import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { getDb } from '../db'
import { agentActivities, agentSessions, kanbanIssueComments, kanbanIssues, workspaces } from '../db/schema'
import type { ChatTurnFinishedPayload } from '../events/domain-events'
import { getWorkflowRules } from '../workflow-rules/workflow-rules'

interface RunIssueInput {
  issueId: string
  agentSessionId: string
  agentProfileId: string
  agentId?: string
}

type IssueAgentChatRuntime = {
  createAndSend: (input: {
    agentId: string
    workspaceId: string
    cwd: string
    text: string
    modelId?: string
    thinkingEffort?: 'low' | 'medium' | 'high'
    agentIdentityId?: string
  }) => Promise<string>
  abort: (chatSessionId: string) => Promise<void>
}

export interface IssueAgentRuntime {
  run: (input: RunIssueInput) => Promise<void>
  stop: (agentSessionId: string) => Promise<void>
}

type IssueAgentRuntimeInternal = IssueAgentRuntime & {
  handleChatTurnFinished: (payload: ChatTurnFinishedPayload) => void
}

export function createIssueAgentRuntime(deps: {
  chat: IssueAgentChatRuntime
}): IssueAgentRuntimeInternal {
  const activeRuns = new Map<string, { chatSessionId: string, aborted: boolean }>()

  async function run(input: RunIssueInput): Promise<void> {
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

    db.update(agentSessions)
      .set({ status: 'active', updatedAt: nowUnix() })
      .where(eq(agentSessions.id, agentSessionId))
      .run()

    addActivity(agentSessionId, 'thought', { body: 'Examining issue...' })

    const prompt = buildPrompt(issue, agentSessionId)
    const rules = await getWorkflowRules(issue.workspaceId, agentId)
    const fullText = appendWorkflowRules(prompt, rules)

    try {
      const chatSessionId = await deps.chat.createAndSend({
        agentId: agentProfileId,
        workspaceId: issue.workspaceId,
        cwd: workspace.path,
        text: fullText,
        agentIdentityId: agentId,
      })

      db.update(agentSessions)
        .set({ chatSessionId, updatedAt: nowUnix() })
        .where(eq(agentSessions.id, agentSessionId))
        .run()

      activeRuns.set(agentSessionId, { chatSessionId, aborted: false })
    }
    catch (error) {
      db.update(agentSessions)
        .set({ status: 'failed', updatedAt: nowUnix() })
        .where(eq(agentSessions.id, agentSessionId))
        .run()

      const errorText = error instanceof Error ? error.message : String(error)
      addActivity(agentSessionId, 'error', { body: errorText }, issueId)
      throw error
    }
  }

  async function stop(agentSessionId: string): Promise<void> {
    const db = getDb()
    const run = activeRuns.get(agentSessionId)

    if (run) {
      run.aborted = true
      try {
        await deps.chat.abort(run.chatSessionId)
      }
      catch {
        // Best-effort abort.
      }
      activeRuns.delete(agentSessionId)
    }
    else {
      const session = db.select().from(agentSessions).where(eq(agentSessions.id, agentSessionId)).get()
      if (session?.chatSessionId) {
        try {
          await deps.chat.abort(session.chatSessionId)
        }
        catch {
          // Best-effort abort.
        }
      }
    }

    db.update(agentSessions)
      .set({ status: 'stopped', updatedAt: nowUnix() })
      .where(eq(agentSessions.id, agentSessionId))
      .run()

    addActivity(agentSessionId, 'response', { body: 'Stopped by user' })
  }

  function handleChatTurnFinished(payload: ChatTurnFinishedPayload): void {
    const db = getDb()
    const matchingRun = [...activeRuns.entries()].find(([, run]) => run.chatSessionId === payload.chatSessionId)
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
      activeRuns.delete(agentSessionId)
    }
    if (run?.aborted) {
      return
    }

    const agentSession = fallbackSession
      ?? db.select().from(agentSessions).where(eq(agentSessions.id, agentSessionId)).get()
    if (!agentSession || agentSession.status === 'stopped') {
      return
    }

    const nextStatus = payload.status === 'failed'
      ? 'failed'
      : payload.status === 'aborted'
        ? 'stopped'
        : 'completed'

    db.update(agentSessions)
      .set({ status: nextStatus, updatedAt: nowUnix() })
      .where(eq(agentSessions.id, agentSessionId))
      .run()

    if (payload.status === 'failed') {
      addActivity(
        agentSessionId,
        'error',
        { body: payload.errorText ?? 'Agent turn failed' },
        agentSession.issueId,
      )
      return
    }

    addActivity(
      agentSessionId,
      'response',
      { body: payload.status === 'aborted' ? 'Stopped by user' : 'Completed work on issue' },
      agentSession.issueId,
    )
  }

  return {
    run,
    stop,
    handleChatTurnFinished,
  }
}

function appendWorkflowRules(
  prompt: string,
  rules: Awaited<ReturnType<typeof getWorkflowRules>>,
): string {
  if (!rules.global && !rules.profileSpecific) {
    return prompt
  }

  let fullText = `${prompt}\n\n---\n## Workflow Rules\n\n`
  if (rules.global) {
    fullText += `${rules.global}\n\n`
  }
  if (rules.profileSpecific) {
    fullText += `${rules.profileSpecific}\n`
  }
  fullText += '---'
  return fullText
}

function buildPrompt(issue: typeof kanbanIssues.$inferSelect, agentSessionId: string): string {
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
    // Ignore invalid JSON.
  }

  try {
    const labels = JSON.parse(issue.labels) as string[]
    if (labels.length > 0) {
      parts.push(`Labels: ${labels.join(', ')}`)
    }
  }
  catch {
    // Ignore invalid labels JSON.
  }

  parts.push(`Priority: ${issue.priority}`)
  parts.push('')

  const db = getDb()
  const priorSessions = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.issueId, issue.id))
    .all()
    .filter(session => session.id !== agentSessionId && (session.status === 'completed' || session.status === 'stopped' || session.status === 'failed'))

  if (priorSessions.length > 0) {
    parts.push('## Prior Agent Work')
    parts.push('This issue was previously worked on by other agents. Here is what they did:')
    parts.push('')
    for (const priorSession of priorSessions) {
      const activities = db
        .select()
        .from(agentActivities)
        .where(eq(agentActivities.agentSessionId, priorSession.id))
        .all()
        .filter(activity => activity.type === 'response' || activity.type === 'error')

      const statusLabel = priorSession.status === 'completed'
        ? 'completed'
        : priorSession.status === 'stopped'
          ? 'stopped by user'
          : 'failed'
      parts.push(`- Session (${statusLabel}):`)
      for (const activity of activities) {
        try {
          const content = JSON.parse(activity.content) as { body?: string }
          if (content.body && content.body !== 'Stopped by user' && content.body !== 'Completed work on issue') {
            const excerpt = content.body.length > 200 ? `${content.body.slice(0, 200)}...` : content.body
            parts.push(`  ${excerpt}`)
          }
        }
        catch {
          // Ignore malformed activity payloads.
        }
      }
    }
    parts.push('')
  }

  parts.push('Please work on this issue. When done, summarize what you changed.')
  return parts.join('\n')
}

function addActivity(
  agentSessionId: string,
  type: 'thought' | 'action' | 'response' | 'elicitation' | 'error' | 'prompt',
  content: Record<string, unknown>,
  issueId?: string,
): void {
  const db = getDb()
  const now = nowUnix()

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

function nowUnix(): number {
  return Math.floor(Date.now() / 1000)
}
