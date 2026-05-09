// Input: none
// Output: canonical approval request/response contracts and zod schemas for the server approval module
// Position: apps/server/src/modules/approval shared types

import { z } from 'zod'

export const approvalOptionSchema = z.object({
  optionId: z.string().trim().min(1),
  label: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
})

export const createApprovalSchema = z.object({
  chatSessionId: z.string().trim().min(1).nullable().optional(),
  agentId: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  options: z.array(approvalOptionSchema).min(1),
})

export const approvalResponseSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  selectedOptionId: z.string().trim().min(1),
})

export type ApprovalOption = z.infer<typeof approvalOptionSchema>
export type CreateApprovalInput = z.infer<typeof createApprovalSchema>
export type ApprovalResponse = z.infer<typeof approvalResponseSchema>
export type ApprovalDecision = ApprovalResponse['decision']

export interface PendingApproval {
  id: string
  chatSessionId: string | null
  agentId: string
  prompt: string
  options: ApprovalOption[]
  createdAt: number
}