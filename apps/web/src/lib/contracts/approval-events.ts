export interface ApprovalRequestedPayload {
  id: string
  chatSessionId: string | null
  agentId: string
  prompt: string
  options: ApprovalOptionPayload[]
  createdAt: number
}

interface ApprovalOptionPayload {
  optionId: string
  label: string
  description?: string
}

export interface ApprovalResolvedPayload {
  approvalId: string
  decision: 'approved' | 'rejected'
  selectedOptionId: string
}
