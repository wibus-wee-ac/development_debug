// Input: IpcService decorator framework, ApprovalService singleton
// Output: ApprovalService IPC surface — thin forwarder for approval operations
// Position: Main-process IPC layer for approval feature

import { IpcMethod, IpcService } from '@cradle/ipc'

import type { ApprovalResponse, PendingApproval } from '../../features/approval/approval-service'
import { getApprovalService } from '../../features/approval/approval-service'

export class ApprovalService extends IpcService {
  static readonly groupName = 'approval'

  @IpcMethod()
  listPending(): PendingApproval[] {
    return getApprovalService().listPending()
  }

  @IpcMethod()
  respond(approvalId: string, response: ApprovalResponse): void {
    getApprovalService().respondApproval(approvalId, response)
  }
}
