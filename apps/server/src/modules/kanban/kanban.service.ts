// Input: kanban store
// Output: kanban capability semantics, default status seeding, and error mapping
// Position: apps/server/src/modules/kanban/kanban.service.ts

import { inject, injectable } from 'tsyringe'

import { AppError } from '../../errors/app-error'
import type { IssueListParams } from './kanban.store'
import { KanbanStore } from './kanban.store'

const DEFAULT_STATUSES = [
  { name: 'To Do', color: null },
  { name: 'In Progress', color: null },
] as const

@injectable()
export class KanbanService {
  constructor(@inject(KanbanStore) private readonly store: KanbanStore) {}

  listBoards(workspaceId?: string) {
    if (workspaceId && !this.store.workspaceExists(workspaceId)) {
      throw workspaceNotFound(workspaceId)
    }
    return this.store.listBoards(workspaceId)
  }

  createBoard(input: { workspaceId: string, name: string, filterConfig?: string | null }) {
    this.requireWorkspace(input.workspaceId)
    const board = this.store.createBoard(input)
    this.ensureDefaultStatuses(input.workspaceId)
    return board
  }

  deleteBoard(id: string): void {
    if (!this.store.getBoard(id)) {
      throw boardNotFound(id)
    }
    this.store.deleteBoard(id)
  }

  listStatuses(workspaceId: string) {
    this.requireWorkspace(workspaceId)
    return this.store.listStatuses(workspaceId)
  }

  listMilestones(workspaceId: string) {
    this.requireWorkspace(workspaceId)
    return this.store.listMilestones(workspaceId)
  }

  listIssues(params: IssueListParams) {
    this.requireWorkspace(params.workspaceId)
    return this.store.listIssues(params)
  }

  getIssue(id: string) {
    const issue = this.store.getIssue(id)
    if (!issue) {
      throw issueNotFound(id)
    }
    return issue
  }

  createIssue(input: {
    workspaceId: string
    title: string
    description?: string | null
    priority?: 'none' | 'low' | 'medium' | 'high' | 'urgent'
    labels?: string[]
    milestoneId?: string | null
    parentIssueId?: string | null
    statusId?: string | null
  }) {
    this.requireWorkspace(input.workspaceId)
    return this.store.createIssue(input)
  }

  updateIssue(id: string, patch: Partial<{
    title: string
    description: string | null
    priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'
    labels: string[]
    milestoneId: string | null
    parentIssueId: string | null
    statusId: string | null
    assigneeKind: string | null
    assigneeId: string | null
  }>) {
    const issue = this.store.updateIssue(id, patch)
    if (!issue) {
      throw issueNotFound(id)
    }
    return issue
  }

  deleteIssue(id: string): void {
    if (!this.store.getIssue(id)) {
      throw issueNotFound(id)
    }
    this.store.clearParentForChildIssues(id)
    this.store.deleteIssue(id)
  }

  listComments(issueId: string) {
    if (!this.store.getIssue(issueId)) {
      throw issueNotFound(issueId)
    }
    return this.store.listComments(issueId)
  }

  addComment(input: { issueId: string, content: string }) {
    if (!this.store.getIssue(input.issueId)) {
      throw issueNotFound(input.issueId)
    }
    return this.store.addComment(input)
  }

  deleteComment(id: string): void {
    if (!this.store.getComment(id)) {
      throw commentNotFound(id)
    }
    this.store.deleteComment(id)
  }

  private requireWorkspace(workspaceId: string): void {
    if (!this.store.workspaceExists(workspaceId)) {
      throw workspaceNotFound(workspaceId)
    }
  }

  private ensureDefaultStatuses(workspaceId: string): void {
    if (this.store.countStatuses(workspaceId) > 0) {
      return
    }
    DEFAULT_STATUSES.forEach((status, index) => {
      this.store.createStatus({
        workspaceId,
        name: status.name,
        color: status.color,
        order: index,
      })
    })
  }
}

function workspaceNotFound(workspaceId: string): AppError {
  return new AppError({ code: 'kanban_workspace_not_found', status: 404, message: 'Workspace not found', details: { workspaceId } })
}

function boardNotFound(boardId: string): AppError {
  return new AppError({ code: 'kanban_board_not_found', status: 404, message: 'Board not found', details: { boardId } })
}

function issueNotFound(issueId: string): AppError {
  return new AppError({ code: 'kanban_issue_not_found', status: 404, message: 'Issue not found', details: { issueId } })
}

function commentNotFound(commentId: string): AppError {
  return new AppError({ code: 'kanban_comment_not_found', status: 404, message: 'Comment not found', details: { commentId } })
}
