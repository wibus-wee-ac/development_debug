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
  const rejectOption = request.options.find(option => option.kind === 'reject_once' || option.kind === 'reject_always')
  console.warn('[acp] permission request denied because legacy approval SSE is removed', {
    agentId: request.agentId,
    chatSessionId,
    toolTitle: request.toolTitle,
  })
  return rejectOption
    ? { outcome: 'selected', optionId: rejectOption.optionId }
    : { outcome: 'cancelled' }
}

function handleSessionTitle(acpSessionId: string, title: string): void {
  for (const chatSessionId of ChatRuntime.listChatSessionIdsByBackendSessionId(acpSessionId)) {
    Session.updateTitle({ id: chatSessionId, title })
  }
}
