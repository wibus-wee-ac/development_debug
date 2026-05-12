// Input: AcpService with an injected ACP application service and mocked Electron IPC shell
// Output: Unit tests proving the ACP IPC adapter only forwards feature-owned behavior
// Position: App-level IPC adapter tests for src/main/app/ipc/acp.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AcpApplicationService } from '../../../acp-feature/acp'
import { AcpService } from '../acp'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  app: {
    getPath: vi.fn(() => '/tmp/user-data'),
    on: vi.fn(),
  },
}))

vi.mock('../../../db', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        orderBy: () => ({ all: () => [] }),
        where: () => ({ get: () => undefined, all: () => [] }),
      }),
    }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: () => ({ run: () => undefined }), run: () => undefined }) }),
    update: () => ({ set: () => ({ where: () => ({ run: () => undefined }) }) }),
    delete: () => ({ where: () => ({ run: () => undefined }) }),
  }),
}))

vi.mock('../../../acp/acp-connection', () => ({
  AcpConnectionManager: {
    getInstance: () => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      isConnected: vi.fn(),
      newSession: vi.fn(),
      prompt: vi.fn(),
      cancel: vi.fn(),
      getSessionState: vi.fn(),
      setSessionModel: vi.fn(),
      setSessionConfigOption: vi.fn(),
    }),
  },
}))

vi.mock('../../../acp/acp-installer', () => ({
  getAgentInstallDir: vi.fn(() => '/tmp/user-data/acp/agents/demo-agent'),
  installBinaryAgent: vi.fn(),
  installPackageAgent: vi.fn(),
  uninstallBinaryAgent: vi.fn(),
  persistFailed: vi.fn(),
  persistInstalled: vi.fn(),
}))

vi.mock('../../../acp/acp-process-manager', () => ({
  AcpProcessManager: {
    getInstance: () => ({
      getMetrics: vi.fn(() => []),
    }),
  },
}))

vi.mock('../../../acp/acp-registry', () => ({
  fetchRegistry: vi.fn(async () => ({ agents: [] })),
  getSupportedDistributionTypes: vi.fn(() => []),
}))

describe('acpService', () => {
  let appService: AcpApplicationService
  let service: AcpService

  beforeEach(() => {
    appService = {
      fetchRegistry: vi.fn(async () => [{ id: 'demo-agent', name: 'Demo Agent' } as never]),
      getDistributionTypes: vi.fn(async () => ['npx'] as Array<'binary' | 'npx' | 'uvx'>),
      listInstalled: vi.fn(() => [{ id: 'demo-agent', status: 'installed' } as never]),
      getInstalled: vi.fn(() => ({ id: 'demo-agent', status: 'installed' } as never)),
      install: vi.fn(async () => ({ id: 'demo-agent', status: 'installed' } as never)),
      cancelInstall: vi.fn(),
      uninstall: vi.fn(async () => {}),
      getAuditLog: vi.fn(() => []),
      getAgentInstallPath: vi.fn(() => '/tmp/user-data/acp/agents/demo-agent'),
      startAgent: vi.fn(async () => ({ ok: true })),
      stopAgent: vi.fn(async () => {}),
      isAgentRunning: vi.fn(() => true),
      createSession: vi.fn(async () => ({ sessionId: 'session-1' })),
      sendPrompt: vi.fn(async () => ({ promptId: 'prompt-1' })),
      cancelPrompt: vi.fn(async () => {}),
      getSessionState: vi.fn(() => ({ mode: 'chat' } as never)),
      setSessionModel: vi.fn(async () => {}),
      setSessionConfigOption: vi.fn(async () => {}),
      getRunningAgentMetrics: vi.fn(() => []),
    }
    service = new AcpService(appService)
  })

  it('delegates registry and install lifecycle calls to the ACP application service', async () => {
    await expect(service.fetchRegistry()).resolves.toEqual([{ id: 'demo-agent', name: 'Demo Agent' }])
    await expect(service.getDistributionTypes('demo-agent')).resolves.toEqual(['npx'])
    expect(service.listInstalled()).toEqual([{ id: 'demo-agent', status: 'installed' }])
    expect(service.getInstalled('demo-agent')).toEqual({ id: 'demo-agent', status: 'installed' })
    await expect(service.install('demo-agent', 'npx')).resolves.toEqual({ id: 'demo-agent', status: 'installed' })
    service.cancelInstall('demo-agent')
    await expect(service.uninstall('demo-agent')).resolves.toBeUndefined()
    expect(service.getAuditLog('demo-agent')).toEqual([])
    expect(service.getAgentInstallPath('demo-agent')).toBe('/tmp/user-data/acp/agents/demo-agent')

    expect(appService.fetchRegistry).toHaveBeenCalled()
    expect(appService.getDistributionTypes).toHaveBeenCalledWith('demo-agent')
    expect(appService.listInstalled).toHaveBeenCalled()
    expect(appService.getInstalled).toHaveBeenCalledWith('demo-agent')
    expect(appService.install).toHaveBeenCalledWith('demo-agent', 'npx')
    expect(appService.cancelInstall).toHaveBeenCalledWith('demo-agent')
    expect(appService.uninstall).toHaveBeenCalledWith('demo-agent')
    expect(appService.getAuditLog).toHaveBeenCalledWith('demo-agent')
    expect(appService.getAgentInstallPath).toHaveBeenCalledWith('demo-agent')
  })

  it('delegates runtime session calls to the ACP application service', async () => {
    await expect(service.startAgent('demo-agent')).resolves.toEqual({ ok: true })
    await expect(service.stopAgent('demo-agent')).resolves.toBeUndefined()
    expect(service.isAgentRunning('demo-agent')).toBe(true)
    await expect(service.createSession('demo-agent', '/tmp/workspace')).resolves.toEqual({ sessionId: 'session-1' })
    await expect(service.sendPrompt('demo-agent', 'session-1', 'hello')).resolves.toEqual({ promptId: 'prompt-1' })
    await expect(service.cancelPrompt('demo-agent', 'session-1')).resolves.toBeUndefined()
    expect(service.getSessionState('demo-agent', 'session-1')).toEqual({ mode: 'chat' })
    await expect(service.setSessionModel('demo-agent', 'session-1', 'gpt-demo')).resolves.toBeUndefined()
    await expect(service.setSessionConfigOption('demo-agent', 'session-1', 'approval', true)).resolves.toBeUndefined()
    expect(service.getRunningAgentMetrics()).toEqual([])

    expect(appService.startAgent).toHaveBeenCalledWith('demo-agent')
    expect(appService.stopAgent).toHaveBeenCalledWith('demo-agent')
    expect(appService.isAgentRunning).toHaveBeenCalledWith('demo-agent')
    expect(appService.createSession).toHaveBeenCalledWith('demo-agent', '/tmp/workspace')
    expect(appService.sendPrompt).toHaveBeenCalledWith('demo-agent', 'session-1', 'hello')
    expect(appService.cancelPrompt).toHaveBeenCalledWith('demo-agent', 'session-1')
    expect(appService.getSessionState).toHaveBeenCalledWith('demo-agent', 'session-1')
    expect(appService.setSessionModel).toHaveBeenCalledWith('demo-agent', 'session-1', 'gpt-demo')
    expect(appService.setSessionConfigOption).toHaveBeenCalledWith('demo-agent', 'session-1', 'approval', true)
    expect(appService.getRunningAgentMetrics).toHaveBeenCalled()
  })
})
