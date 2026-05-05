// Input: Approval service types
// Output: Approval push event payload types for IPC channels
// Position: Shared types used by main (ApprovalService), preload (approvalPush), and renderer (approval hooks)

export interface ApprovalRequestedPayload {
  id: string
  chatSessionId: string | null
  agentId: string
  prompt: string
  options: ApprovalOptionPayload[]
  createdAt: number
}

export interface ApprovalOptionPayload {
  optionId: string
  label: string
  description?: string
}

export interface ApprovalResolvedPayload {
  approvalId: string
  decision: 'approved' | 'rejected'
  selectedOptionId: string
}
