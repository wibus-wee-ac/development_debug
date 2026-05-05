// Input: Issue-agent query application service, in-memory fake store, and issue-agent schema row types
// Output: Behavior tests for issue-agent session/activity queries without native SQLite dependencies
// Position: Issue-agent feature query test for issue-agent-query.ts

import { describe, expect, it, vi } from 'vitest'

import type { AgentActivity, AgentSession } from '../../../db/schema'
import type { IssueAgentQueryStore } from '../issue-agent-query'
import { createIssueAgentQueryApplicationService } from '../issue-agent-query'

vi.mock('better-sqlite3', () => ({
  default: class MockBetterSqliteDatabase {},
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: false },
}))

interface FakeStoreState {
  sessions: AgentSession[]
  activities: AgentActivity[]
}

function clone<T>(value: T): T {
  return { ...value }
}

function createStore(state: FakeStoreState): IssueAgentQueryStore {
  return {
    listAgentSessionsByIssue(issueId) {
      return state.sessions
        .filter(session => session.issueId === issueId)
        .map(clone)
    },
    listAgentActivitiesBySession(agentSessionId) {
      return state.activities
        .filter(activity => activity.agentSessionId === agentSessionId)
        .map(clone)
    },
  }
}

function createAgentSession(id: string, issueId: string, createdAt: number): AgentSession {
  return {
    id,
    issueId,
    agentProfileId: 'profile-1',
    chatSessionId: null,
    status: 'active',
    createdAt,
    updatedAt: createdAt,
  }
}

function createAgentActivity(id: string, agentSessionId: string, createdAt: number): AgentActivity {
  return {
    id,
    agentSessionId,
    type: 'thought',
    content: JSON.stringify({ body: id }),
    signal: null,
    signalMetadata: null,
    createdAt,
  }
}

describe('issueAgentQueryApplicationService', () => {
  it('lists agent sessions newest-first and activities oldest-first', () => {
    const service = createIssueAgentQueryApplicationService({
      store: createStore({
        sessions: [
          createAgentSession('agent-session-old', 'issue-1', 10),
          createAgentSession('agent-session-new', 'issue-1', 20),
          createAgentSession('agent-session-other', 'issue-2', 30),
        ],
        activities: [
          createAgentActivity('activity-late', 'agent-session-new', 20),
          createAgentActivity('activity-early', 'agent-session-new', 10),
          createAgentActivity('activity-other', 'agent-session-old', 5),
        ],
      }),
    })

    expect(service.listAgentSessions('issue-1').map(session => session.id)).toEqual([
      'agent-session-new',
      'agent-session-old',
    ])
    expect(service.listAgentActivities('agent-session-new').map(activity => activity.id)).toEqual([
      'activity-early',
      'activity-late',
    ])
  })
})
