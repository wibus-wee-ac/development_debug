import { randomUUID } from 'node:crypto'

import { approvalAudit } from '@cradle/db'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import * as SessionService from '../session/service'

// ── types ──

export interface ApprovalOption {
  optionId: string
  label: string
  description?: string
}

export interface CreateApprovalInput {
  chatSessionId?: string | null
  agentId: string
  prompt: string
  options: ApprovalOption[]
}

export interface ApprovalResponse {
  decision: 'approved' | 'rejected'
  selectedOptionId: string
}

export interface PendingApproval {
  id: string
  chatSessionId: string | null
  agentId: string
  prompt: string
  options: ApprovalOption[]
  createdAt: number
}

export type ApprovalRequestedListener = (approval: PendingApproval) => void
export type ApprovalResolvedListener = (approvalId: string, response: ApprovalResponse) => void

// ── module-level state ──

interface PendingEntry {
  approval: PendingApproval
  resolve: (response: ApprovalResponse) => void
  responsePromise: Promise<ApprovalResponse>
}

const pending = new Map<string, PendingEntry>()
const requestedListeners = new Set<ApprovalRequestedListener>()
const resolvedListeners = new Set<ApprovalResolvedListener>()

// ── public API ──

export function createPending(input: CreateApprovalInput): PendingApproval {
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

  pending.set(id, { approval, resolve, responsePromise })
  emitRequested(approval)
  return approval
}

export function requestApproval(input: CreateApprovalInput): Promise<ApprovalResponse> {
  const approval = createPending(input)
  return pending.get(approval.id)!.responsePromise
}

export function respond(approvalId: string, response: ApprovalResponse): void {
  const entry = pending.get(approvalId)
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

  pending.delete(approvalId)
  entry.resolve(response)
  emitResolved(approvalId, response)

  // Record audit entry
  try {
    const toolName = extractToolName(entry.approval.prompt)
    db().insert(approvalAudit).values({
      id: randomUUID(),
      sessionId: entry.approval.chatSessionId,
      toolName,
      decision: response.decision,
      selectedOptionId: response.selectedOptionId,
    }).run()
  }
  catch (e) {
    console.warn('[approval] audit write failed', e)
  }
}

export function rejectPendingBySession(chatSessionId: string): number {
  let count = 0
  for (const [id, entry] of pending) {
    if (entry.approval.chatSessionId === chatSessionId) {
      pending.delete(id)
      entry.resolve({ decision: 'rejected', selectedOptionId: 'deny' })
      count++
    }
  }
  return count
}

export function listPending(filter?: { chatSessionId?: string }): PendingApproval[] {
  return Array.from(pending.values(), entry => entry.approval)
    .filter((approval) => {
      if (filter?.chatSessionId && approval.chatSessionId !== filter.chatSessionId) {
        return false
      }
      return true
    })
    .sort((left, right) => left.createdAt - right.createdAt)
}

export function onRequested(listener: ApprovalRequestedListener): () => void {
  requestedListeners.add(listener)
  return () => {
    requestedListeners.delete(listener)
  }
}

export function onResolved(listener: ApprovalResolvedListener): () => void {
  resolvedListeners.add(listener)
  return () => {
    resolvedListeners.delete(listener)
  }
}

// ── helpers ──

const TOOL_NAME_RE = /^Allow tool "(.+?)"\?/

function extractToolName(prompt: string): string {
  const match = prompt.match(TOOL_NAME_RE)
  return match?.[1] ?? prompt.slice(0, 100)
}

function emitRequested(approval: PendingApproval): void {
  for (const listener of [...requestedListeners]) {
    try {
      listener(approval)
    }
    catch {
      // listeners must not break the request flow
    }
  }
}

function emitResolved(approvalId: string, response: ApprovalResponse): void {
  for (const listener of [...resolvedListeners]) {
    try {
      listener(approvalId, response)
    }
    catch {
      // listeners must not break the resolution flow
    }
  }
}

// ── policy keys (session-scoped "allow always") ──

const allowedPolicies = new Map<string, Set<string>>()

export function generatePolicyKeys(input: { runtimeKind: string, chatSessionId: string, toolName: string }): string[] {
  return [
    `${input.runtimeKind}:session:${input.chatSessionId}:tool:${input.toolName}`,
  ]
}

export function isPreviouslyAllowed(chatSessionId: string, policyKeys: string[]): boolean {
  const sessionSet = allowedPolicies.get(chatSessionId)
  if (!sessionSet) {
    return false
  }
  return policyKeys.some(key => sessionSet.has(key))
}

export function markAllowed(chatSessionId: string, policyKeys: string[]): void {
  let sessionSet = allowedPolicies.get(chatSessionId)
  if (!sessionSet) {
    sessionSet = new Set<string>()
    allowedPolicies.set(chatSessionId, sessionSet)
  }
  for (const key of policyKeys) {
    sessionSet.add(key)
  }
}

export function clearSessionPolicies(chatSessionId: string): void {
  allowedPolicies.delete(chatSessionId)
}

// Clean up policy keys and pending approvals when a session is deleted
SessionService.onSessionCleanup((sessionId) => {
  clearSessionPolicies(sessionId)
  rejectPendingBySession(sessionId)
})
