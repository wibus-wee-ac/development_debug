import * as Approval from '../../../approval/service'
import * as Session from '../../../session/service'
import * as ChatRuntime from '../../service'
import type { AcpConnectionManager } from './connection-manager'

export function wireAcpIntegration(runtime: AcpConnectionManager): void {
  runtime.setPermissionHandler(request => handlePermission(request))
  runtime.onSessionTitle((acpSessionId, title) => {
    handleSessionTitle(acpSessionId, title)
  })
}

async function handlePermission(request: {
  agentId: string
  sessionId: string
  toolTitle: string
  options: Array<{ optionId: string, name: string, kind: string }>
}): Promise<{ outcome: 'selected' | 'cancelled', optionId?: string }> {
  const chatSessionId = ChatRuntime.listChatSessionIdsByBackendSessionId(request.sessionId)[0] ?? null
  const response = await Approval.requestApproval({
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

function handleSessionTitle(acpSessionId: string, title: string): void {
  for (const chatSessionId of ChatRuntime.listChatSessionIdsByBackendSessionId(acpSessionId)) {
    Session.updateTitle({ id: chatSessionId, title })
  }
}
