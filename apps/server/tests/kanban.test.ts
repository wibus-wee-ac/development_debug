import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { agentProfiles, agents, sessions, workspaces } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'

interface KanbanStatus {
  id: string
  name: string
  workspaceId: string
}

interface KanbanBoard {
  id: string
  name: string
  workspaceId: string
}

interface Issue {
  id: string
  number: number
  title: string
  description: string | null
  workspaceId: string
  statusId: string | null
  priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  createdByKind: 'user' | 'agent' | 'system'
  createdById: string
}

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('kanban capability', () => {
  it('creates boards, seeds default statuses, and supports the issue/comment core loop', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-kanban',
        name: 'Workspace Kanban',
        identifier: 'KAN',
        path: workspaceRoot,
      }).run()

      const createBoard = await app.handle(new Request('http://localhost/kanban/boards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'workspace-kanban', name: 'Backend Board' }),
      }))
      expect(createBoard.status).toBe(200)
      const board = await createBoard.json() as KanbanBoard
      expect(board).toEqual(expect.objectContaining({ name: 'Backend Board', workspaceId: 'workspace-kanban' }))

      const listBoards = await app.handle(new Request('http://localhost/kanban/boards?workspaceId=workspace-kanban'))
      expect(listBoards.status).toBe(200)
      expect(await listBoards.json()).toEqual([expect.objectContaining({ id: board.id, name: 'Backend Board' })])

      const listStatuses = await app.handle(new Request('http://localhost/issues/statuses?workspaceId=workspace-kanban'))
      expect(listStatuses.status).toBe(200)
      const statuses = await listStatuses.json() as KanbanStatus[]
      expect(statuses.map(status => status.name)).toEqual(['Triage', 'Backlog', 'To Do', 'In Progress', 'Done', 'Canceled'])

      const todoStatusId = statuses[2].id // 'To Do'
      const inProgressStatusId = statuses[3].id // 'In Progress'

      const createIssue = await app.handle(new Request('http://localhost/issues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'workspace-kanban',
          title: 'Server issue',
          description: 'Issue created from HTTP server',
          priority: 'high',
          statusId: todoStatusId,
        }),
      }))
      expect(createIssue.status).toBe(200)
      const issue = await createIssue.json() as Issue
      expect(issue).toEqual(expect.objectContaining({ id: 'KAN-001', number: 1 }))
      expect(issue).toEqual(expect.objectContaining({ title: 'Server issue', statusId: todoStatusId, priority: 'high' }))
      expect(issue).toEqual(expect.objectContaining({ createdByKind: 'user', createdById: '__self__' }))

      const createIssueWithoutStatus = await app.handle(new Request('http://localhost/issues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'workspace-kanban',
          title: 'Server issue without status',
        }),
      }))
      expect(createIssueWithoutStatus.status).toBe(200)
      const issueWithoutStatus = await createIssueWithoutStatus.json() as Issue
      expect(issueWithoutStatus).toEqual(expect.objectContaining({ id: 'KAN-002', number: 2 }))
      expect(issueWithoutStatus).toEqual(expect.objectContaining({ statusId: statuses[0].id }))

      const createIssueWithStatusName = await app.handle(new Request('http://localhost/issues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'workspace-kanban',
          title: 'Server issue with status name',
          statusName: 'to_do',
        }),
      }))
      expect(createIssueWithStatusName.status).toBe(200)
      const issueWithStatusName = await createIssueWithStatusName.json() as Issue
      expect(issueWithStatusName).toEqual(expect.objectContaining({ id: 'KAN-003', number: 3 }))
      expect(issueWithStatusName).toEqual(expect.objectContaining({ statusId: todoStatusId }))

      const createIssueWithConflictingStatusRefs = await app.handle(new Request('http://localhost/issues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'workspace-kanban',
          title: 'Server issue with conflicting status refs',
          statusId: todoStatusId,
          statusName: 'in_progress',
        }),
      }))
      expect(createIssueWithConflictingStatusRefs.status).toBe(400)

      const updateIssue = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issue.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Updated issue', description: 'Updated description' }),
      }))
      expect(updateIssue.status).toBe(200)
      expect(await updateIssue.json()).toEqual(expect.objectContaining({ title: 'Updated issue', description: 'Updated description' }))

      const moveIssue = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issue.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ statusId: inProgressStatusId }),
      }))
      expect(moveIssue.status).toBe(200)
      expect(await moveIssue.json()).toEqual(expect.objectContaining({ statusId: inProgressStatusId }))

      const moveIssueByStatusName = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issueWithStatusName.id)}/status/in_progress`, {
        method: 'PATCH',
      }))
      expect(moveIssueByStatusName.status).toBe(200)
      expect(await moveIssueByStatusName.json()).toEqual(expect.objectContaining({ statusId: inProgressStatusId }))

      const listIssues = await app.handle(new Request('http://localhost/issues?workspaceId=workspace-kanban'))
      expect(listIssues.status).toBe(200)
      expect(await listIssues.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: issue.id, statusId: inProgressStatusId }),
        expect.objectContaining({ id: issueWithoutStatus.id, statusId: statuses[0].id }),
        expect.objectContaining({ id: issueWithStatusName.id, statusId: inProgressStatusId }),
      ]))

      const searchByIssueId = await app.handle(new Request('http://localhost/issues/search?q=KAN-001'))
      expect(searchByIssueId.status).toBe(200)
      expect(await searchByIssueId.json()).toEqual([
        expect.objectContaining({ id: issue.id, number: 1 }),
      ])

      const searchByIssueNumber = await app.handle(new Request('http://localhost/issues/search?q=2'))
      expect(searchByIssueNumber.status).toBe(200)
      expect(await searchByIssueNumber.json()).toEqual([
        expect.objectContaining({ id: issueWithoutStatus.id, number: 2 }),
      ])

      const addComment = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issue.id)}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'Looks good to me' }),
      }))
      expect(addComment.status).toBe(200)
      const comment = await addComment.json() as { id: string, content: string, issueId: string, authorKind: string, authorId: string | null, author: { kind: string, id: string | null, displayName: string, label: string | null } }
      expect(comment).toEqual(expect.objectContaining({ issueId: issue.id, content: 'Looks good to me' }))
      expect(comment).toEqual(expect.objectContaining({ authorKind: 'user', authorId: '__self__' }))
      expect(comment.author).toEqual(expect.objectContaining({ kind: 'user', id: '__self__', displayName: 'You', label: null }))

      const listComments = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issue.id)}/comments`))
      expect(listComments.status).toBe(200)
      expect(await listComments.json()).toEqual([expect.objectContaining({ id: comment.id, content: 'Looks good to me' })])

      const deleteComment = await app.handle(new Request(`http://localhost/issues/comments/${encodeURIComponent(comment.id)}`, { method: 'DELETE' }))
      expect(deleteComment.status).toBe(200)
      expect(await deleteComment.json()).toEqual({ ok: true })

      const deleteIssue = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issue.id)}`, { method: 'DELETE' }))
      expect(deleteIssue.status).toBe(200)
      expect(await deleteIssue.json()).toEqual({ ok: true })

      const deleteIssueWithoutStatus = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issueWithoutStatus.id)}`, { method: 'DELETE' }))
      expect(deleteIssueWithoutStatus.status).toBe(200)
      expect(await deleteIssueWithoutStatus.json()).toEqual({ ok: true })

      const deleteIssueWithStatusName = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issueWithStatusName.id)}`, { method: 'DELETE' }))
      expect(deleteIssueWithStatusName.status).toBe(200)
      expect(await deleteIssueWithStatusName.json()).toEqual({ ok: true })

      const issuesAfterDelete = await app.handle(new Request('http://localhost/issues?workspaceId=workspace-kanban'))
      expect(issuesAfterDelete.status).toBe(200)
      expect(await issuesAfterDelete.json()).toEqual([])
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('records agent provenance from the chat session runtime context', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-kanban-agent',
        name: 'Workspace Kanban Agent',
        identifier: 'KAG',
        path: workspaceRoot,
      }).run()
      db().insert(agentProfiles).values({
        id: 'profile-kanban-agent',
        name: 'Kanban Agent Profile',
        providerKind: 'openai-compatible',
      }).run()
      db().insert(agents).values({
        id: 'agent-kanban',
        name: 'Kanban Agent',
        avatarStyle: 'bottts-neutral',
        avatarSeed: 'kanban-agent',
        agentProfileId: 'profile-kanban-agent',
      }).run()
      db().insert(sessions).values({
        id: 'chat-session-kanban-agent',
        workspaceId: 'workspace-kanban-agent',
        title: 'Agent Runtime',
        agentProfileId: 'profile-kanban-agent',
        agentId: 'agent-kanban',
      }).run()

      const createIssue = await app.handle(new Request('http://localhost/issues', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-cradle-chat-session-id': 'chat-session-kanban-agent',
        },
        body: JSON.stringify({
          workspaceId: 'workspace-kanban-agent',
          title: 'Agent-created issue',
        }),
      }))
      expect(createIssue.status).toBe(200)
      const issue = await createIssue.json() as Issue
      expect(issue).toEqual(expect.objectContaining({ id: 'KAG-001', number: 1 }))
      expect(issue).toEqual(expect.objectContaining({
        createdByKind: 'agent',
        createdById: 'agent-kanban',
      }))

      const addComment = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issue.id)}/comments`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-cradle-chat-session-id': 'chat-session-kanban-agent',
        },
        body: JSON.stringify({ content: 'Agent status update' }),
      }))
      expect(addComment.status).toBe(200)
      expect(await addComment.json()).toEqual(expect.objectContaining({
        authorKind: 'agent',
        authorId: 'agent-kanban',
        author: expect.objectContaining({
          kind: 'agent',
          id: 'agent-kanban',
          displayName: 'Kanban Agent',
          label: 'Agent',
        }),
        content: 'Agent status update',
      }))
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('binds Jarvis comments to a stable jar-core agent identity from the chat session', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-jarvis-comment',
        name: 'Workspace Jarvis Comment',
        identifier: 'JAR',
        path: workspaceRoot,
      }).run()
      db().insert(agentProfiles).values({
        id: 'profile-jarvis-runtime',
        name: 'Jar Core Runtime',
        providerKind: 'openai-compatible',
      }).run()

      const sessionRes = await app.handle(new Request('http://localhost/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'chat-session-jarvis-comment',
          workspaceId: 'workspace-jarvis-comment',
          title: 'Jarvis Runtime',
          agentProfileId: 'profile-jarvis-runtime',
          runtimeKind: 'jar-core',
        }),
      }))
      expect(sessionRes.status).toBe(200)
      const session = await sessionRes.json() as { agentId: string }
      const jarvisAgent = db().select().from(agents).where(eq(agents.id, session.agentId)).get()
      expect(jarvisAgent).toEqual(expect.objectContaining({
        name: 'Jarvis',
        agentProfileId: 'profile-jarvis-runtime',
        runtimeKind: 'jar-core',
        avatarSeed: 'jarvis',
      }))

      const createIssue = await app.handle(new Request('http://localhost/issues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'workspace-jarvis-comment',
          title: 'Jarvis-authored comment issue',
        }),
      }))
      expect(createIssue.status).toBe(200)
      const issue = await createIssue.json() as Issue

      const addComment = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issue.id)}/comments`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-cradle-chat-session-id': 'chat-session-jarvis-comment',
        },
        body: JSON.stringify({ content: 'Jarvis owns this comment' }),
      }))
      expect(addComment.status).toBe(200)
      expect(await addComment.json()).toEqual(expect.objectContaining({
        authorKind: 'agent',
        authorId: session.agentId,
        author: expect.objectContaining({
          kind: 'agent',
          id: session.agentId,
          displayName: 'Jarvis',
          label: 'AI',
        }),
        content: 'Jarvis owns this comment',
      }))
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('rejects profile-only runtime context instead of using profile id as an agent author', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-kanban-profile-only',
        name: 'Workspace Kanban Profile Only',
        identifier: 'KPO',
        path: workspaceRoot,
      }).run()
      db().insert(agentProfiles).values({
        id: 'profile-kanban-profile-only',
        name: 'Profile Only',
        providerKind: 'openai-compatible',
      }).run()
      db().insert(sessions).values({
        id: 'chat-session-profile-only',
        workspaceId: 'workspace-kanban-profile-only',
        title: 'Legacy Profile Only Runtime',
        agentProfileId: 'profile-kanban-profile-only',
        agentId: null,
      }).run()

      const createIssue = await app.handle(new Request('http://localhost/issues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'workspace-kanban-profile-only',
          title: 'Profile-only context issue',
        }),
      }))
      expect(createIssue.status).toBe(200)
      const issue = await createIssue.json() as Issue

      const addComment = await app.handle(new Request(`http://localhost/issues/${encodeURIComponent(issue.id)}/comments`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-cradle-chat-session-id': 'chat-session-profile-only',
        },
        body: JSON.stringify({ content: 'Should not be profile-authored' }),
      }))

      expect(addComment.status).toBe(409)
      expect(await addComment.json()).toEqual(expect.objectContaining({
        code: 'runtime_agent_identity_missing',
      }))
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('uses workspace-derived issue IDs and skips conflicting IDs with the same prefix', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const firstWorkspaceRoot = makeTempDir('cradle-workspace-')
    const secondWorkspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values([
        {
          id: 'workspace-app-one',
          name: 'App One',
          identifier: 'APP',
          path: firstWorkspaceRoot,
        },
        {
          id: 'workspace-app-two',
          name: 'App Two',
          identifier: 'APP',
          path: secondWorkspaceRoot,
        },
      ]).run()

      const firstIssueRes = await app.handle(new Request('http://localhost/issues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'workspace-app-one', title: 'First APP issue' }),
      }))
      expect(firstIssueRes.status).toBe(200)
      const firstIssue = await firstIssueRes.json() as Issue
      expect(firstIssue).toEqual(expect.objectContaining({ id: 'APP-001', number: 1 }))

      const secondIssueRes = await app.handle(new Request('http://localhost/issues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'workspace-app-two', title: 'Second APP issue' }),
      }))
      expect(secondIssueRes.status).toBe(200)
      const secondIssue = await secondIssueRes.json() as Issue
      expect(secondIssue).toEqual(expect.objectContaining({ id: 'APP-002', number: 2 }))
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(firstWorkspaceRoot, { recursive: true, force: true })
      rmSync(secondWorkspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('returns structured errors for invalid input and missing resources', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-kanban',
        name: 'Workspace Kanban',
        path: workspaceRoot,
      }).run()

      const invalidBoard = await app.handle(new Request('http://localhost/kanban/boards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'workspace-kanban' }),
      }))
      expect(invalidBoard.status).toBe(400)
      expect((await invalidBoard.json()).code).toBe('validation_error')

      const missingWorkspaceBoard = await app.handle(new Request('http://localhost/kanban/boards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'missing', name: 'Nope' }),
      }))
      expect(missingWorkspaceBoard.status).toBe(404)
      expect((await missingWorkspaceBoard.json()).code).toBe('kanban_workspace_not_found')

      const missingIssue = await app.handle(new Request('http://localhost/issues/missing-issue'))
      expect(missingIssue.status).toBe(404)
      expect((await missingIssue.json()).code).toBe('issue_not_found')

      const missingBoardDelete = await app.handle(new Request('http://localhost/kanban/boards/missing-board', { method: 'DELETE' }))
      expect(missingBoardDelete.status).toBe(404)
      expect((await missingBoardDelete.json()).code).toBe('kanban_board_not_found')
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })
})
