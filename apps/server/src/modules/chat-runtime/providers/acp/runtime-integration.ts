// Input: ACP connection manager plus server approval/session/chat stores
// Output: bridges ACP permission and title callbacks into server-owned business modules
// Position: apps/server chat-runtime ACP integration layer

import { inject, injectable } from 'tsyringe'

import { ApprovalService } from '../../../approval/approval.service'
import { SessionService } from '../../../session/session.service'
import { ChatRuntimeStore } from '../../chat-runtime.store'
import { AcpConnectionManager } from './connection-manager'

@injectable()
export class AcpRuntimeIntegration {
  constructor(
    @inject(AcpConnectionManager) runtime: AcpConnectionManager,
    @inject(ApprovalService) private readonly approvalService: ApprovalService,
    @inject(ChatRuntimeStore) private readonly chatRuntimeStore: ChatRuntimeStore,
    @inject(SessionService) private readonly sessionService: SessionService,
  ) {
    runtime.setPermissionHandler(request => this.handlePermission(request))
    runtime.onSessionTitle((acpSessionId, title) => {
      this.handleSessionTitle(acpSessionId, title)
    })
  }

  private async handlePermission(request: {
    agentId: string
    sessionId: string
    toolTitle: string
    options: Array<{ optionId: string, name: string, kind: string }>
  }): Promise<{ outcome: 'selected' | 'cancelled', optionId?: string }> {
    const chatSessionId = this.chatRuntimeStore.listChatSessionIdsByBackendSessionId(request.sessionId)[0] ?? null
    const response = await this.approvalService.requestApproval({
      chatSessionId,
      agentId: request.agentId,
      prompt: request.toolTitle,
      options: request.options.map(option => ({
        optionId: option.optionId,
        label: option.name,
        description: option.kind,
      })),
    })

    if (response.decision === 'rejected') {
      const rejectOption = request.options.find(option => option.kind === 'reject_once' || option.kind === 'reject_always')
      if (rejectOption) {
        return { outcome: 'selected', optionId: rejectOption.optionId }
      }
      return { outcome: 'cancelled' }
    }

    return { outcome: 'selected', optionId: response.selectedOptionId }
  }

  private handleSessionTitle(acpSessionId: string, title: string): void {
    for (const chatSessionId of this.chatRuntimeStore.listChatSessionIdsByBackendSessionId(acpSessionId)) {
      this.sessionService.updateTitle({ id: chatSessionId, title })
    }
  }
}