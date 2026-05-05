// Input: IssueAgentService, mocked issue-agent application/query services, and IPC runtime stubs
// Output: Unit tests for issue-agent IPC delegation and query forwarding
// Position: Context-owned IPC adapter test for src/main/app/ipc/issue-agent.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { IssueAgentQueryApplicationService } from '../../../features/issue-agent/issue-agent-query'
import type { IssueDelegationApplicationService } from '../../../features/issue-agent/issue-delegation'
import { IssueAgentService } from '../issue-agent'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: {
    dev: true,
  },
}))

vi.mock('node:async_hooks', () => ({
  AsyncLocalStorage: class {
    getStore = vi.fn()
    run = vi.fn()
  },
}))

describe('issueAgentService', () => {
  let delegationApp: IssueDelegationApplicationService
  let queryApp: IssueAgentQueryApplicationService
  let service: IssueAgentService

  beforeEach(() => {
    delegationApp = {
      delegateIssue: vi.fn(async () => ({ id: 'session-1' } as never)),
      runDelegatedIssue: vi.fn(async () => {}),
      stopAgentSession: vi.fn(async () => {}),
      undelegateIssue: vi.fn(async () => {}),
    }
    queryApp = {
      listAgentSessions: vi.fn(() => [{ id: 'session-1' } as never]),
      listAgentActivities: vi.fn(() => [{ id: 'activity-1' } as never]),
    }
    service = new IssueAgentService(delegationApp, queryApp)
  })

  it('forwards delegation commands to the issue-agent application service', async () => {
    await service.delegateIssue('issue-1', 'profile-1', 'agent-1')
    await service.runDelegatedIssue('issue-1', 'session-1', 'profile-1', 'agent-1')
    await service.stopAgentSession('session-1')
    await service.undelegateIssue('issue-1')

    expect(delegationApp.delegateIssue).toHaveBeenCalledWith({ issueId: 'issue-1', agentProfileId: 'profile-1' })
    expect(delegationApp.runDelegatedIssue).toHaveBeenCalledWith({
      issueId: 'issue-1',
      agentSessionId: 'session-1',
      agentProfileId: 'profile-1',
      agentId: 'agent-1',
    })
    expect(delegationApp.stopAgentSession).toHaveBeenCalledWith('session-1')
    expect(delegationApp.undelegateIssue).toHaveBeenCalledWith('issue-1')
  })

  it('forwards query methods to the issue-agent query service', () => {
    expect(service.getAgentSessions('issue-1')).toEqual([{ id: 'session-1' }])
    expect(service.getAgentActivities('session-1')).toEqual([{ id: 'activity-1' }])
    expect(queryApp.listAgentSessions).toHaveBeenCalledWith('issue-1')
    expect(queryApp.listAgentActivities).toHaveBeenCalledWith('session-1')
  })
})
