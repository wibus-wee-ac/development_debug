// Input: approval request parameters and renderer/operator responses
// Output: approval registry managing pending approval lifecycle with Promise-based resolution
// Position: feature owner for the server approval workflow

import { randomUUID } from 'node:crypto'

import { injectable } from 'tsyringe'

import { AppError } from '../../errors/app-error'
import type { ApprovalResponse, CreateApprovalInput, PendingApproval } from './approval.types'

interface PendingEntry {
  approval: PendingApproval
  resolve: (response: ApprovalResponse) => void
  responsePromise: Promise<ApprovalResponse>
}

export type ApprovalRequestedListener = (approval: PendingApproval) => void
export type ApprovalResolvedListener = (approvalId: string, response: ApprovalResponse) => void

@injectable()
export class ApprovalService {
  private readonly pending = new Map<string, PendingEntry>()
  private readonly requestedListeners = new Set<ApprovalRequestedListener>()
  private readonly resolvedListeners = new Set<ApprovalResolvedListener>()

  createPending(input: CreateApprovalInput): PendingApproval {
    const id = randomUUID()
    const approval: PendingApproval = {
      id,
      chatSessionId: input.chatSessionId ?? null,
      agentId: input.agentId,
      prompt: input.prompt,
      options: input.options,
      createdAt: Date.now(),
    }

    let resolve!: (response: ApprovalResponse) => void
    const responsePromise = new Promise<ApprovalResponse>((resolver) => {
      resolve = resolver
    })

    this.pending.set(id, { approval, resolve, responsePromise })
    this.emitRequested(approval)
    return approval
  }

  requestApproval(input: CreateApprovalInput): Promise<ApprovalResponse> {
    const approval = this.createPending(input)
    return this.pending.get(approval.id)!.responsePromise
  }

  respond(approvalId: string, response: ApprovalResponse): void {
    const entry = this.pending.get(approvalId)
    if (!entry) {
      throw new AppError({
        code: 'approval_not_found',
        status: 404,
        message: 'Approval request not found',
        details: { approvalId },
      })
    }

    if (!entry.approval.options.some(option => option.optionId === response.selectedOptionId)) {
      throw new AppError({
        code: 'invalid_approval_input',
        status: 400,
        message: 'selectedOptionId is not valid for this approval',
        details: { approvalId, selectedOptionId: response.selectedOptionId },
      })
    }

    this.pending.delete(approvalId)
    entry.resolve(response)
    this.emitResolved(approvalId, response)
  }

  listPending(filter?: { chatSessionId?: string }): PendingApproval[] {
    return Array.from(this.pending.values(), entry => entry.approval)
      .filter((approval) => {
        if (filter?.chatSessionId && approval.chatSessionId !== filter.chatSessionId) {
          return false
        }
        return true
      })
      .sort((left, right) => left.createdAt - right.createdAt)
  }

  onRequested(listener: ApprovalRequestedListener): () => void {
    this.requestedListeners.add(listener)
    return () => {
      this.requestedListeners.delete(listener)
    }
  }

  onResolved(listener: ApprovalResolvedListener): () => void {
    this.resolvedListeners.add(listener)
    return () => {
      this.resolvedListeners.delete(listener)
    }
  }

  private emitRequested(approval: PendingApproval): void {
    for (const listener of [...this.requestedListeners]) {
      try {
        listener(approval)
      }
      catch {
        // listeners must not break the request flow
      }
    }
  }

  private emitResolved(approvalId: string, response: ApprovalResponse): void {
    for (const listener of [...this.resolvedListeners]) {
      try {
        listener(approvalId, response)
      }
      catch {
        // listeners must not break the resolution flow
      }
    }
  }
}