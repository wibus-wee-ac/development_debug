// Input: issue-agent HTTP endpoints
// Output: integration tests for delegation, activities, rerun, undelegate, and structured errors
// Position: apps/server/tests

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { workspaces } from '@cradle/db'
import { describe, expect, it, vi } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'

interface AgentSessionView {
  id: string
  issueId: string
  agentProfileId: string
  chatSessionId: string | null
  status: 'created' | 'active' | 'completed' | 'stopped' | 'failed'
  isCurrentDelegation: boolean
}

interface DelegationState {
  issueId: string
  delegated: boolean
  agentProfileId: string | null
  agentSessionId: string | null
  chatSessionId: string | null
}

interface AgentActivityView {
  id: string
  type: string
  content: string
  signal: string | null
}

type ElysiaApp = ReturnType<typeof createServerApp>

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

async function createProfile(app: ElysiaApp) {
  const credentialRes = await app.handle(new Request('http://localhost/secrets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'openai-compatible',
      label: 'Issue Agent Key',
      secret: 'sk-issue-agent-test',
    }),
  }))
  const credential = await credentialRes.json() as { id: string }

  const profileRes = await app.handle(new Request('http://localhost/profiles/profile-issue-agent', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Mock LLM',
      providerKind: 'openai-compatible',
      enabled: true,
      config: { baseUrl: 'https://example.com/v1', model: 'gpt-4o-mini' },
      credentialRef: credential.id,
    }),
  }))
  expect(profileRes.status).toBe(200)
}

async function createIssue(app: ElysiaApp, workspaceId: string) {
  const boardRes = await app.handle(new Request('http://localhost/kanban/boards', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspaceId, name: 'Agent Board' }),
  }))
  expect(boardRes.status).toBe(200)

  const statusesRes = await app.handle(new Request(`http://localhost/kanban/statuses?workspaceId=${encodeURIComponent(workspaceId)}`))
  const statuses = await statusesRes.json() as Array<{ id: string, name: string }>
  const todoStatusId = statuses[0].id

  const issueRes = await app.handle(new Request('http://localhost/kanban/issues', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workspaceId,
      title: 'Delegated issue',
      description: 'Please investigate this server task.',
      statusId: todoStatusId,
      priority: 'high',
      labels: ['backend'],
    }),
  }))
  expect(issueRes.status).toBe(200)
  return await issueRes.json() as { id: string, title: string }
}

async function waitForSessionStatus(app: ElysiaApp, issueId: string, expectedStatus: AgentSessionView['status']): Promise<AgentSessionView[]> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await app.handle(new Request(`http://localhost/kanban/issues/${encodeURIComponent(issueId)}/agent-sessions`))
    if (response.status === 200) {
      const sessions = await response.json() as AgentSessionView[]
      if (sessions[0]?.status === expectedStatus) {
        return sessions
      }
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for agent session status ${expectedStatus}`)
}

describe('issue-agent capability', () => {
  it('delegates an issue, exposes activities and chat output, supports rerun, and clears delegation', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'issue-agent-secret'

    let completionIndex = 0
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (!url.endsWith('/chat/completions')) {
        throw new Error(`Unexpected fetch URL: ${url}`)
      }
      completionIndex += 1
      const responseText = completionIndex === 1 ? 'Hello from delegated run 1' : 'Hello from delegated run 2'
      const encoder = new TextEncoder()
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: {"id":"chunk-${completionIndex}-1","choices":[{"delta":{"content":"${responseText}"}}]}\n\n`))
          controller.enqueue(encoder.encode(`data: {"id":"chunk-${completionIndex}-2","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":5,"total_tokens":17}}\n\n`))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      }), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    })

    let app: ReturnType<typeof createServerApp> | undefined

    try {
      app = createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-issue-agent',
        name: 'Workspace Issue Agent',
        path: workspaceRoot,
      }).run()

      await createProfile(app)
      const issue = await createIssue(app, 'workspace-issue-agent')

      const delegateRes = await app.handle(new Request(`http://localhost/kanban/issues/${encodeURIComponent(issue.id)}/delegation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentProfileId: 'profile-issue-agent' }),
      }))
      expect(delegateRes.status).toBe(200)
      const delegatedSession = await delegateRes.json() as AgentSessionView
      expect(delegatedSession.issueId).toBe(issue.id)
      expect(delegatedSession.agentProfileId).toBe('profile-issue-agent')

      const sessionsAfterDelegate = await waitForSessionStatus(app, issue.id, 'completed')
      expect(sessionsAfterDelegate).toHaveLength(1)
      expect(sessionsAfterDelegate[0]).toEqual(expect.objectContaining({
        id: delegatedSession.id,
        isCurrentDelegation: true,
        status: 'completed',
      }))

      const delegationStateRes = await app.handle(new Request(`http://localhost/kanban/issues/${encodeURIComponent(issue.id)}/delegation`))
      expect(delegationStateRes.status).toBe(200)
      const delegationState = await delegationStateRes.json() as DelegationState
      expect(delegationState).toEqual(expect.objectContaining({
        issueId: issue.id,
        delegated: true,
        agentProfileId: 'profile-issue-agent',
        agentSessionId: delegatedSession.id,
      }))
      expect(delegationState.chatSessionId).toBeTruthy()

      const activitiesRes = await app.handle(new Request(`http://localhost/issue-agent-sessions/${encodeURIComponent(delegatedSession.id)}/activities`))
      expect(activitiesRes.status).toBe(200)
      const activities = await activitiesRes.json() as AgentActivityView[]
      expect(activities.map(activity => JSON.parse(activity.content).body)).toEqual(expect.arrayContaining([
        'Delegated to Mock LLM',
        'Examining issue...',
        'Completed work on issue',
      ]))

      const messagesRes = await app.handle(new Request(`http://localhost/sessions/${encodeURIComponent(String(delegationState.chatSessionId))}/messages`))
      expect(messagesRes.status).toBe(200)
      const messages = await messagesRes.json() as Array<{ role: string, content: string, status: string }>
      expect(messages.at(-1)).toEqual(expect.objectContaining({ role: 'assistant', content: 'Hello from delegated run 1', status: 'complete' }))

      const rerunRes = await app.handle(new Request(`http://localhost/issue-agent-sessions/${encodeURIComponent(delegatedSession.id)}/rerun`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }))
      expect(rerunRes.status).toBe(200)

      const sessionsAfterRerun = await waitForSessionStatus(app, issue.id, 'completed')
      const rerunSession = sessionsAfterRerun[0]
      expect(rerunSession.id).toBe(delegatedSession.id)
      expect(rerunSession.chatSessionId).toBeTruthy()
      expect(rerunSession.chatSessionId).not.toBe(delegationState.chatSessionId)

      const rerunMessagesRes = await app.handle(new Request(`http://localhost/sessions/${encodeURIComponent(String(rerunSession.chatSessionId))}/messages`))
      expect(rerunMessagesRes.status).toBe(200)
      const rerunMessages = await rerunMessagesRes.json() as Array<{ role: string, content: string }>
      expect(rerunMessages.at(-1)).toEqual(expect.objectContaining({ role: 'assistant', content: 'Hello from delegated run 2' }))

      const undelegateRes = await app.handle(new Request(`http://localhost/kanban/issues/${encodeURIComponent(issue.id)}/delegation`, { method: 'DELETE' }))
      expect(undelegateRes.status).toBe(200)
      expect(await undelegateRes.json()).toEqual({ ok: true })

      const delegationAfterDeleteRes = await app.handle(new Request(`http://localhost/kanban/issues/${encodeURIComponent(issue.id)}/delegation`))
      expect(delegationAfterDeleteRes.status).toBe(200)
      expect(await delegationAfterDeleteRes.json()).toEqual(expect.objectContaining({
        issueId: issue.id,
        delegated: false,
        agentProfileId: null,
        agentSessionId: null,
        chatSessionId: null,
      }))

      const activitiesAfterDeleteRes = await app.handle(new Request(`http://localhost/issue-agent-sessions/${encodeURIComponent(delegatedSession.id)}/activities`))
      const activitiesAfterDelete = await activitiesAfterDeleteRes.json() as AgentActivityView[]
      expect(activitiesAfterDelete.map(activity => JSON.parse(activity.content).body)).toContain('Delegation removed')
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    }
    finally {
      fetchSpy.mockRestore()
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      }
      else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })

  it('returns structured errors for invalid input and missing resources', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousSecret = process.env.CRADLE_CREDENTIAL_SECRET
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'issue-agent-secret'

    let app: ReturnType<typeof createServerApp> | undefined

    try {
      app = createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-issue-agent',
        name: 'Workspace Issue Agent',
        path: workspaceRoot,
      }).run()

      await createProfile(app)
      const issue = await createIssue(app, 'workspace-issue-agent')

      const invalidDelegate = await app.handle(new Request(`http://localhost/kanban/issues/${encodeURIComponent(issue.id)}/delegation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }))
      expect(invalidDelegate.status).toBe(400)
      expect((await invalidDelegate.json()).code).toBe('validation_error')

      const missingIssue = await app.handle(new Request('http://localhost/kanban/issues/missing-issue/delegation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentProfileId: 'profile-issue-agent' }),
      }))
      expect(missingIssue.status).toBe(404)
      expect((await missingIssue.json()).code).toBe('issue_agent_issue_not_found')

      const missingProfile = await app.handle(new Request(`http://localhost/kanban/issues/${encodeURIComponent(issue.id)}/delegation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentProfileId: 'missing-profile' }),
      }))
      expect(missingProfile.status).toBe(404)
      expect((await missingProfile.json()).code).toBe('issue_agent_profile_not_found')

      const missingActivities = await app.handle(new Request('http://localhost/issue-agent-sessions/missing-session/activities'))
      expect(missingActivities.status).toBe(404)
      expect((await missingActivities.json()).code).toBe('issue_agent_session_not_found')

      const missingRerun = await app.handle(new Request('http://localhost/issue-agent-sessions/missing-session/rerun', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }))
      expect(missingRerun.status).toBe(404)
      expect((await missingRerun.json()).code).toBe('issue_agent_session_not_found')
    }
    finally {
      vi.restoreAllMocks()
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      }
      else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousSecret
      }
    }
  })
})
