// Input: Approval service types
// Output: Approval push event payload types for SSE/push channels
// Position: Web app contract types for approval domain events

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
