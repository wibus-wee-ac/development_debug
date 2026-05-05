// Input: Kanban query store abstraction, optional Drizzle-backed store factory, and schema row types
// Output: Kanban read-side application service for statuses, boards, milestones, issues, comments, relations, and session-linked projections
// Position: Kanban context application query boundary between IPC adapters and persistence

import { eq, or } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import { getDb } from '../../db'
import type * as schema from '../../db/schema'
import type {
  AgentSession,
  KanbanBoard,
  KanbanIssue,
  KanbanIssueComment,
  KanbanIssueRelation,
  KanbanMilestone,
  KanbanStatus,
  Session,
} from '../../db/schema'
import {
  agentSessions,
  kanbanBoards,
  kanbanIssueComments,
  kanbanIssueRelations,
  kanbanIssues,
  kanbanMilestones,
  kanbanStatuses,
  sessions,
} from '../../db/schema'

interface ListIssuesParams {
  workspaceId: string
  milestoneId?: string | null
  parentIssueId?: string | null
  priority?: string | null
  labels?: string[] | null
  statusId?: string | null
}

interface LinkedIssueResult {
  issue: KanbanIssue
  status: KanbanStatus | null
  agentSession: AgentSession | null
}

export interface KanbanQueryApplicationService {
  listStatuses: (workspaceId: string) => KanbanStatus[]
  listBoards: (workspaceId?: string) => KanbanBoard[]
  listMilestones: (workspaceId: string) => KanbanMilestone[]
  listIssues: (params: ListIssuesParams) => KanbanIssue[]
  searchIssues: (query: string, limit?: number) => KanbanIssue[]
  getIssue: (id: string) => KanbanIssue | undefined
  listComments: (issueId: string) => KanbanIssueComment[]
  listRelations: (issueId: string) => KanbanIssueRelation[]
  getLinkedIssue: (chatSessionId: string) => LinkedIssueResult | null
}

export interface KanbanQueryStore {
  listStatusesByWorkspace: (workspaceId: string) => KanbanStatus[]
  listBoards: (workspaceId?: string) => KanbanBoard[]
  listMilestonesByWorkspace: (workspaceId: string) => KanbanMilestone[]
  listIssues: () => KanbanIssue[]
  getIssue: (id: string) => KanbanIssue | undefined
  listCommentsByIssue: (issueId: string) => KanbanIssueComment[]
  listRelationsByIssue: (issueId: string) => KanbanIssueRelation[]
  getAgentSessionByChatSessionId: (chatSessionId: string) => AgentSession | undefined
  getSession: (id: string) => Session | undefined
  getStatus: (id: string) => KanbanStatus | undefined
}

interface KanbanQueryApplicationDeps {
  store?: KanbanQueryStore
  db?: BetterSQLite3Database<typeof schema>
}

function resolveDefaultDb(): BetterSQLite3Database<typeof schema> {
  return getDb()
}

export function createDrizzleKanbanQueryStore(
  db: BetterSQLite3Database<typeof schema>,
): KanbanQueryStore {
  return {
    listStatusesByWorkspace(workspaceId) {
      return db.select().from(kanbanStatuses).where(eq(kanbanStatuses.workspaceId, workspaceId)).all()
    },
    listBoards(workspaceId) {
      if (workspaceId === undefined) {
        return db.select().from(kanbanBoards).all()
      }
      return db.select().from(kanbanBoards).where(eq(kanbanBoards.workspaceId, workspaceId)).all()
    },
    listMilestonesByWorkspace(workspaceId) {
      return db.select().from(kanbanMilestones).where(eq(kanbanMilestones.workspaceId, workspaceId)).all()
    },
    listIssues() {
      return db.select().from(kanbanIssues).all()
    },
    getIssue(id) {
      return db.select().from(kanbanIssues).where(eq(kanbanIssues.id, id)).get()
    },
    listCommentsByIssue(issueId) {
      return db.select().from(kanbanIssueComments).where(eq(kanbanIssueComments.issueId, issueId)).all()
    },
    listRelationsByIssue(issueId) {
      return db
        .select()
        .from(kanbanIssueRelations)
        .where(or(
          eq(kanbanIssueRelations.sourceIssueId, issueId),
          eq(kanbanIssueRelations.targetIssueId, issueId),
        ))
        .all()
    },
    getAgentSessionByChatSessionId(chatSessionId) {
      return db.select().from(agentSessions).where(eq(agentSessions.chatSessionId, chatSessionId)).get()
    },
    getSession(id) {
      return db.select().from(sessions).where(eq(sessions.id, id)).get()
    },
    getStatus(id) {
      return db.select().from(kanbanStatuses).where(eq(kanbanStatuses.id, id)).get()
    },
  }
}

function sortAscByCreatedAt<T extends { createdAt: number }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => left.createdAt - right.createdAt)
}

function sortDescByCreatedAt<T extends { createdAt: number }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => right.createdAt - left.createdAt)
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter((value): value is string => typeof value === 'string')
  }
  catch {
    return []
  }
}

export function createKanbanQueryApplicationService(
  deps: KanbanQueryApplicationDeps = {},
): KanbanQueryApplicationService {
  const store = deps.store ?? createDrizzleKanbanQueryStore(deps.db ?? resolveDefaultDb())

  const listStatuses: KanbanQueryApplicationService['listStatuses'] = (workspaceId) => {
    return [...store.listStatusesByWorkspace(workspaceId)]
      .sort((left, right) => left.order - right.order)
  }

  const listBoards: KanbanQueryApplicationService['listBoards'] = (workspaceId) => {
    return sortDescByCreatedAt(store.listBoards(workspaceId))
  }

  const listMilestones: KanbanQueryApplicationService['listMilestones'] = (workspaceId) => {
    return sortDescByCreatedAt(store.listMilestonesByWorkspace(workspaceId))
  }

  const listIssues: KanbanQueryApplicationService['listIssues'] = (params) => {
    return sortDescByCreatedAt(store.listIssues())
      .filter(issue => issue.workspaceId === params.workspaceId)
      .filter((issue) => {
        if (params.milestoneId == null) {
          return true
        }
        return issue.milestoneId === params.milestoneId
      })
      .filter((issue) => {
        if (params.parentIssueId == null) {
          return true
        }
        return issue.parentIssueId === params.parentIssueId
      })
      .filter((issue) => {
        if (params.priority == null) {
          return true
        }
        return issue.priority === params.priority
      })
      .filter((issue) => {
        if (params.statusId === undefined) {
          return true
        }
        if (params.statusId === null) {
          return issue.statusId === null
        }
        return issue.statusId === params.statusId
      })
      .filter((issue) => {
        if (!params.labels || params.labels.length === 0) {
          return true
        }
        const labels = parseStringArray(issue.labels)
        return params.labels.every(label => labels.includes(label))
      })
  }

  const searchIssues: KanbanQueryApplicationService['searchIssues'] = (query, limit = 20) => {
    const trimmedQuery = query.trim().toLowerCase()
    if (!trimmedQuery) {
      return []
    }

    return store.listIssues()
      .filter((issue) => {
        const title = issue.title.toLowerCase()
        const description = issue.description?.toLowerCase() ?? ''
        return title.includes(trimmedQuery) || description.includes(trimmedQuery)
      })
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, limit)
  }

  const getIssue: KanbanQueryApplicationService['getIssue'] = (id) => {
    return store.getIssue(id)
  }

  const listComments: KanbanQueryApplicationService['listComments'] = (issueId) => {
    return sortAscByCreatedAt(store.listCommentsByIssue(issueId))
  }

  const listRelations: KanbanQueryApplicationService['listRelations'] = (issueId) => {
    return sortAscByCreatedAt(store.listRelationsByIssue(issueId))
  }

  const getLinkedIssue: KanbanQueryApplicationService['getLinkedIssue'] = (chatSessionId) => {
    const agentSession = store.getAgentSessionByChatSessionId(chatSessionId)
    if (agentSession) {
      const issue = store.getIssue(agentSession.issueId)
      if (issue) {
        const status = issue.statusId ? store.getStatus(issue.statusId) ?? null : null
        return { issue, status, agentSession }
      }
    }

    const session = store.getSession(chatSessionId)
    if (session?.linkedIssueId) {
      const issue = store.getIssue(session.linkedIssueId)
      if (issue) {
        const status = issue.statusId ? store.getStatus(issue.statusId) ?? null : null
        return { issue, status, agentSession: null }
      }
    }

    return null
  }

  return {
    listStatuses,
    listBoards,
    listMilestones,
    listIssues,
    searchIssues,
    getIssue,
    listComments,
    listRelations,
    getLinkedIssue,
  }
}
