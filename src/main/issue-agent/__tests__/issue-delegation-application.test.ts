// Input: IssueDelegationApplicationService, mocked delegation store, and mocked runner
// Output: Behavior tests for delegation state transitions and comments projection
// Position: Issue-agent feature write-side test for issue-delegation.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  IssueDelegationRunner,
  IssueDelegationStore,
} from '../issue-delegation'
import {
  createIssueDelegationApplicationService,
} from '../issue-delegation'

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'session-1'),
}))

describe('issueDelegationApplicationService', () => {
  let runner: IssueDelegationRunner
  let store: IssueDelegationStore
  const now = vi.fn(() => 100)

  beforeEach(() => {
    vi.clearAllMocks()
    runner = {
      run: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
    }
    store = {
      getAgentProfile: vi.fn(),
      createDelegation: vi.fn(),
      removeDelegation: vi.fn(),
    }
  })

  it('creates a delegation session and emits system delegated comment', async () => {
    vi.mocked(store.getAgentProfile).mockReturnValue({ id: 'profile-1', name: 'Planner' })
    vi.mocked(store.createDelegation).mockReturnValue({
        id: 'session-1',
        issueId: 'issue-1',
        agentProfileId: 'profile-1',
        status: 'created',
        chatSessionId: null,
        createdAt: 100,
        updatedAt: 100,
      })

    const service = createIssueDelegationApplicationService({ store, runner, nowUnix: now })
    const session = await service.delegateIssue({ issueId: 'issue-1', agentProfileId: 'profile-1' })

    expect(session.id).toBe('session-1')
    expect(store.getAgentProfile).toHaveBeenCalledWith('profile-1')
    expect(store.createDelegation).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'issue-1',
      agentProfileId: 'profile-1',
      agentProfileName: 'Planner',
      sessionId: 'session-1',
      timestamp: 100,
    }))
  })

  it('forwards run command to runner', async () => {
    const service = createIssueDelegationApplicationService({ store, runner, nowUnix: now })
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
    const service = createIssueDelegationApplicationService({ store, runner, nowUnix: now })
    await service.stopAgentSession('agent-session-2')
    expect(runner.stop).toHaveBeenCalledWith('agent-session-2')
  })

  it('removes delegation and writes undelegated system comment', async () => {
    const service = createIssueDelegationApplicationService({ store, runner, nowUnix: now })
    await service.undelegateIssue('issue-9')

    expect(store.removeDelegation).toHaveBeenCalledWith(expect.objectContaining({
      issueId: 'issue-9',
      timestamp: 100,
    }))
  })

  it('throws when delegation profile does not exist', async () => {
    vi.mocked(store.getAgentProfile).mockReturnValue(undefined)

    const service = createIssueDelegationApplicationService({ store, runner, nowUnix: now })
    await expect(service.delegateIssue({ issueId: 'issue-1', agentProfileId: 'missing-profile' }))
      .rejects
      .toThrow('Agent profile missing-profile not found')
  })

  it('throws when store does not return a created delegation session', async () => {
    vi.mocked(store.getAgentProfile).mockReturnValue({ id: 'profile-1', name: 'Planner' })
    vi.mocked(store.createDelegation).mockReturnValue(undefined)

    const service = createIssueDelegationApplicationService({ store, runner, nowUnix: now })
    await expect(service.delegateIssue({ issueId: 'issue-1', agentProfileId: 'profile-1' }))
      .rejects
      .toThrow('Delegation session was not created for issue issue-1')
  })
})
