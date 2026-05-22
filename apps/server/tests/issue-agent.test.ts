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
  agentId: string | null
  chatSessionId: string | null
  status: 'created' | 'active' | 'completed' | 'stopped' | 'failed'
  isCurrentDelegation: boolean
}

interface DelegationState {
  issueId: string
  delegated: boolean
  agentProfileId: string | null
  agentId: string | null
  agentSessionId: string | null
  chatSessionId: string | null
}

interface AgentActivityView {
  id: string
  type: string
  content: string
  signal: string | null
}

type ElysiaApp = Awaited<ReturnType<typeof createServerApp>>

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

async function createAgent(app: ElysiaApp) {
  const agentRes = await app.handle(new Request('http://localhost/agents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Issue Agent',
      avatarStyle: 'bottts-neutral',
      avatarSeed: 'issue-agent',
      agentProfileId: 'profile-issue-agent',
      runtimeKind: 'standard',
    }),
  }))
  expect(agentRes.status).toBe(200)
  return await agentRes.json() as { id: string, name: string, agentProfileId: string }
}

async function createIssue(app: ElysiaApp, workspaceId: string) {
  const boardRes = await app.handle(new Request('http://localhost/kanban/boards', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspaceId, name: 'Agent Board' }),
  }))
  expect(boardRes.status).toBe(200)

  const statusesRes = await app.handle(new Request(`http://localhost/issues/statuses?workspaceId=${encodeURIComponent(workspaceId)}`))
  const statuses = await statusesRes.json() as Array<{ id: string, name: string }>
  const todoStatusId = statuses[0].id

  const issueRes = await app.handle(new Request('http://localhost/issues', {
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
    const response = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issueId)}/agent-sessions`))
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
    const completionBodies: string[] = []
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new Request(input).url
      if (!url.endsWith('/chat/completions')) {
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      }
      completionBodies.push(String(init?.body ?? ''))
      completionIndex += 1
      const responseText = completionIndex === 1 ? 'Hello from delegated run 1' : 'Hello from delegated run 2'
      const encoder = new TextEncoder()
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: {"id":"chunk-${completionIndex}-1","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"${responseText}"},"finish_reason":null}]}\n\n`))
          controller.enqueue(encoder.encode(`data: {"id":"chunk-${completionIndex}-2","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":5,"total_tokens":17}}\n\n`))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      }), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-issue-agent',
        name: 'Workspace Issue Agent',
        path: workspaceRoot,
      }).run()

      await createProfile(app)
      const agent = await createAgent(app)
      const issue = await createIssue(app, 'workspace-issue-agent')

      const delegateRes = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issue.id)}/delegation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId: agent.id }),
      }))
      expect(delegateRes.status).toBe(200)
      const delegatedSession = await delegateRes.json() as AgentSessionView
      expect(delegatedSession.issueId).toBe(issue.id)
      expect(delegatedSession.agentProfileId).toBe('profile-issue-agent')
      expect(delegatedSession.agentId).toBe(agent.id)

      const sessionsAfterDelegate = await waitForSessionStatus(app, issue.id, 'completed')
      expect(sessionsAfterDelegate).toHaveLength(1)
      expect(sessionsAfterDelegate[0]).toEqual(expect.objectContaining({
        id: delegatedSession.id,
        isCurrentDelegation: true,
        status: 'completed',
      }))

      const delegationStateRes = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issue.id)}/delegation`))
      expect(delegationStateRes.status).toBe(200)
      const delegationState = await delegationStateRes.json() as DelegationState
      expect(delegationState).toEqual(expect.objectContaining({
        issueId: issue.id,
        delegated: true,
        agentProfileId: 'profile-issue-agent',
        agentId: agent.id,
        agentSessionId: delegatedSession.id,
      }))
      expect(delegationState.chatSessionId).toBeTruthy()

      const commentsRes = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issue.id)}/comments`))
      expect(commentsRes.status).toBe(200)
      expect(await commentsRes.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({ authorKind: 'system.delegated', authorId: null }),
      ]))

      const activitiesRes = await app.handle(new Request(`http://localhost/issue-agent-sessions/${encodeURIComponent(delegatedSession.id)}/activities`))
      expect(activitiesRes.status).toBe(200)
      const activities = await activitiesRes.json() as AgentActivityView[]
      expect(activities.map(activity => JSON.parse(activity.content).body)).toEqual(expect.arrayContaining([
        'Delegated to Issue Agent',
        'Examining issue...',
        'Completed work on issue',
      ]))

      const messagesRes = await app.handle(new Request(`http://localhost/sessions/${encodeURIComponent(String(delegationState.chatSessionId))}/messages`))
      expect(messagesRes.status).toBe(200)
      const messages = await messagesRes.json() as Array<{ role: string, content: string, status: string }>
      expect(messages.at(-1)).toEqual(expect.objectContaining({ role: 'assistant', content: 'Hello from delegated run 1', status: 'complete' }))
      expect(completionBodies[0]).toContain(`Issue ID: ${issue.id}`)

      const chatSessionRes = await app.handle(new Request(`http://localhost/sessions/${encodeURIComponent(String(delegationState.chatSessionId))}`))
      expect(chatSessionRes.status).toBe(200)
      expect(await chatSessionRes.json()).toEqual(expect.objectContaining({ agentId: agent.id }))

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

      const undelegateRes = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issue.id)}/delegation`, { method: 'DELETE' }))
      expect(undelegateRes.status).toBe(200)
      expect(await undelegateRes.json()).toEqual({ ok: true })

      const delegationAfterDeleteRes = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issue.id)}/delegation`))
      expect(delegationAfterDeleteRes.status).toBe(200)
      expect(await delegationAfterDeleteRes.json()).toEqual(expect.objectContaining({
        issueId: issue.id,
        delegated: false,
        agentProfileId: null,
        agentId: null,
        agentSessionId: null,
        chatSessionId: null,
      }))

      const activitiesAfterDeleteRes = await app.handle(new Request(`http://localhost/issue-agent-sessions/${encodeURIComponent(delegatedSession.id)}/activities`))
      const activitiesAfterDelete = await activitiesAfterDeleteRes.json() as AgentActivityView[]
      expect(activitiesAfterDelete.map(activity => JSON.parse(activity.content).body)).toContain('Delegation removed')
      expect(fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/chat/completions'))).toHaveLength(2)
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

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-issue-agent',
        name: 'Workspace Issue Agent',
        path: workspaceRoot,
      }).run()

      await createProfile(app)
      const agent = await createAgent(app)
      const issue = await createIssue(app, 'workspace-issue-agent')

      const invalidDelegate = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issue.id)}/delegation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }))
      expect(invalidDelegate.status).toBe(400)
      expect((await invalidDelegate.json()).code).toBe('validation_error')

      const missingIssue = await app.handle(new Request('http://localhost/issues/missing-issue/delegation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId: agent.id }),
      }))
      expect(missingIssue.status).toBe(404)
      expect((await missingIssue.json()).code).toBe('issue_agent_issue_not_found')

      const missingAgent = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issue.id)}/delegation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId: 'missing-agent' }),
      }))
      expect(missingAgent.status).toBe(404)
      expect((await missingAgent.json()).code).toBe('issue_agent_agent_not_found')

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
