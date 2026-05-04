// Input: IssueDelegationApplicationService, mocked DB context, and mocked runner
// Output: Behavior tests for delegation state transitions and comments projection
// Position: Unit test for src/main/application/issue-delegation-application.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createIssueDelegationApplicationService,
  type IssueDelegationDbContext,
  type IssueDelegationRunner,
} from '../issue-delegation-application'

const selectGetQueue: unknown[] = []

const selectWhereGet = vi.fn(() => selectGetQueue.shift())
const selectWhereAll = vi.fn(() => [])
const selectWhere = vi.fn(() => ({ get: selectWhereGet, all: selectWhereAll }))
const selectFrom = vi.fn(() => ({ where: selectWhere, all: selectWhereAll }))
const select = vi.fn(() => ({ from: selectFrom }))

const updateRun = vi.fn()
const updateWhere = vi.fn(() => ({ run: updateRun }))
const updateSet = vi.fn(() => ({ where: updateWhere }))
const update = vi.fn(() => ({ set: updateSet }))

const insertRun = vi.fn()
const insertValues = vi.fn(() => ({ run: insertRun }))
const insert = vi.fn(() => ({ values: insertValues }))

const transaction = vi.fn((fn: (tx: IssueDelegationDbContext) => unknown) => fn(mockDb as unknown as IssueDelegationDbContext))

const mockDb = {
  select,
  update,
  insert,
  transaction,
}

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'session-1'),
}))

vi.mock('../../db', () => ({
  getDb: () => mockDb,
}))

describe('issueDelegationApplicationService', () => {
  let runner: IssueDelegationRunner
  const now = vi.fn(() => 100)

  beforeEach(() => {
    vi.clearAllMocks()
    selectGetQueue.length = 0
    runner = {
      run: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
    }
  })

  it('creates a delegation session and emits system delegated comment', async () => {
    selectGetQueue.push(
      { id: 'profile-1', name: 'Planner' },
      {
        id: 'session-1',
        issueId: 'issue-1',
        agentProfileId: 'profile-1',
        status: 'created',
        chatSessionId: null,
        createdAt: 100,
        updatedAt: 100,
      },
    )

    const service = createIssueDelegationApplicationService({ runner, nowUnix: now })
    const session = await service.delegateIssue({ issueId: 'issue-1', agentProfileId: 'profile-1' })

    expect(update).toHaveBeenCalled()
    expect(insert).toHaveBeenCalled()
    expect(session.id).toBe('session-1')
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'issue-1',
      content: 'Delegated to Planner',
      authorKind: 'system.delegated',
    }))
  })

  it('forwards run command to runner', async () => {
    const service = createIssueDelegationApplicationService({ runner, nowUnix: now })
    await service.runDelegatedIssue({
      issueId: 'issue-1',
      agentSessionId: 'agent-session-1',
      agentProfileId: 'profile-1',
      agentId: 'identity-1',
    })

    expect(runner.run).toHaveBeenCalledWith({
      issueId: 'issue-1',
      agentSessionId: 'agent-session-1',
      agentProfileId: 'profile-1',
      agentId: 'identity-1',
    })
  })

  it('stops an active session via runner', async () => {
    const service = createIssueDelegationApplicationService({ runner, nowUnix: now })
    await service.stopAgentSession('agent-session-2')
    expect(runner.stop).toHaveBeenCalledWith('agent-session-2')
  })

  it('removes delegation and writes undelegated system comment', async () => {
    const service = createIssueDelegationApplicationService({ runner, nowUnix: now })
    await service.undelegateIssue('issue-9')

    expect(update).toHaveBeenCalled()
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'issue-9',
      content: 'Delegation removed',
      authorKind: 'system.undelegated',
    }))
  })

  it('throws when delegation profile does not exist', async () => {
    selectGetQueue.push(undefined)

    const service = createIssueDelegationApplicationService({ runner, nowUnix: now })
    await expect(service.delegateIssue({ issueId: 'issue-1', agentProfileId: 'missing-profile' }))
      .rejects
      .toThrow('Agent profile missing-profile not found')
  })
})
