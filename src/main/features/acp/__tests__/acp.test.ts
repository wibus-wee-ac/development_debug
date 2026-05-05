// Input: fake ACP registry, installer, runtime, and persistence dependencies
// Output: Regression tests for ACP application service install lifecycle and runtime orchestration
// Position: Feature tests for src/main/features/acp/acp.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AcpAgent } from '../../../db/schema'
import type { RegistryAgent } from '../../../platform/acp/acp-registry'
import type { AcpDistributionType, AcpRuntimeController, AcpStore } from '../acp'
import { createAcpApplicationService } from '../acp'

function makeInstalledAgent(overrides: Partial<AcpAgent> = {}): AcpAgent {
  return {
    id: 'demo-agent',
    name: 'Demo Agent',
    version: '1.0.0',
    distributionType: 'npx',
    installPath: null,
    cmd: 'demo-agent-package',
    args: '[]',
    env: '{}',
    status: 'installed',
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  }
}

describe('acp application service', () => {
  const registryAgent: RegistryAgent = {
    id: 'demo-agent',
    name: 'Demo Agent',
    version: '1.0.0',
    description: 'Demo ACP agent',
    distribution: {
      npx: {
        package: 'demo-agent-package',
        args: ['--stdio'],
      },
      binary: {
        'darwin-aarch64': {
          archive: 'https://example.com/demo-agent.tar.gz',
          cmd: 'bin/demo-agent',
          args: ['--serve'],
        },
      },
    },
  }

  let installed: AcpAgent | undefined
  let store: {
    listInstalled: ReturnType<typeof vi.fn>
    getInstalled: ReturnType<typeof vi.fn>
    markInstalling: ReturnType<typeof vi.fn>
    saveInstalled: ReturnType<typeof vi.fn>
    markFailed: ReturnType<typeof vi.fn>
    deleteInstalled: ReturnType<typeof vi.fn>
    getAuditLog: ReturnType<typeof vi.fn>
    recordAudit: ReturnType<typeof vi.fn>
    upsertAutoProfile: ReturnType<typeof vi.fn>
    deleteAutoProfile: ReturnType<typeof vi.fn>
  }
  let runtime: {
    startAgent: ReturnType<typeof vi.fn>
    stopAgent: ReturnType<typeof vi.fn>
    isAgentRunning: ReturnType<typeof vi.fn>
    createSession: ReturnType<typeof vi.fn>
    sendPrompt: ReturnType<typeof vi.fn>
    cancelPrompt: ReturnType<typeof vi.fn>
    getSessionState: ReturnType<typeof vi.fn>
    setSessionModel: ReturnType<typeof vi.fn>
    setSessionConfigOption: ReturnType<typeof vi.fn>
    getRunningAgentMetrics: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    installed = undefined
    store = {
      listInstalled: vi.fn(() => installed ? [installed] : []),
      getInstalled: vi.fn(() => installed),
      markInstalling: vi.fn(({ agentId, name, version, distributionType }) => {
        installed = makeInstalledAgent({
          id: agentId,
          name,
          version,
          distributionType,
          cmd: null,
          status: 'installing',
        })
      }),
      saveInstalled: vi.fn(({ agent, distributionType, result }) => {
        installed = makeInstalledAgent({
          id: agent.id,
          name: agent.name,
          version: agent.version,
          distributionType,
          installPath: result.installPath,
          cmd: result.cmd,
          args: JSON.stringify(result.args ?? []),
          env: JSON.stringify(result.env ?? {}),
          status: 'installed',
        })
      }),
      markFailed: vi.fn((agentId: string) => {
        installed = makeInstalledAgent({ id: agentId, status: 'failed' })
      }),
      deleteInstalled: vi.fn(() => {
        installed = undefined
      }),
      getAuditLog: vi.fn(() => []),
      recordAudit: vi.fn(),
      upsertAutoProfile: vi.fn(),
      deleteAutoProfile: vi.fn(),
    }
    runtime = {
      startAgent: vi.fn(async () => ({ ok: true })),
      stopAgent: vi.fn(async () => {}),
      isAgentRunning: vi.fn(() => true),
      createSession: vi.fn(async () => ({ sessionId: 'session-1' })),
      sendPrompt: vi.fn(async () => ({ promptId: 'prompt-1' })),
      cancelPrompt: vi.fn(async () => {}),
      getSessionState: vi.fn(() => null),
      setSessionModel: vi.fn(async () => {}),
      setSessionConfigOption: vi.fn(async () => {}),
      getRunningAgentMetrics: vi.fn(() => []),
    }
  })

  it('installs ACP agents and upserts an auto-created agent profile', async () => {
    const service = createAcpApplicationService({
      registry: {
        fetchRegistry: vi.fn(async () => [registryAgent]),
        getSupportedDistributionTypes: vi.fn(() => ['binary', 'npx'] as AcpDistributionType[]),
      },
      store: store as AcpStore,
      installer: {
        installBinaryAgent: vi.fn(),
        installPackageAgent: vi.fn(() => ({
          installPath: null,
          cmd: 'demo-agent-package',
          args: ['--stdio'],
          env: {},
        })),
        uninstallBinaryAgent: vi.fn(async () => {}),
      },
      runtime: runtime as AcpRuntimeController,
      paths: {
        getUserDataPath: vi.fn(() => '/tmp/user-data'),
        getAgentInstallPath: vi.fn((agentId: string) => `/tmp/user-data/acp/agents/${agentId}`),
      },
    })

    const result = await service.install('demo-agent', 'npx')

    expect(store.markInstalling).toHaveBeenCalledWith({
      agentId: 'demo-agent',
      name: 'Demo Agent',
      version: '1.0.0',
      distributionType: 'npx',
    })
    expect(result).toMatchObject({
      id: 'demo-agent',
      status: 'installed',
      cmd: 'demo-agent-package',
    })
    expect(store.saveInstalled).toHaveBeenCalledWith({
      agent: registryAgent,
      distributionType: 'npx',
      result: {
        installPath: null,
        cmd: 'demo-agent-package',
        args: ['--stdio'],
        env: {},
      },
    })
    expect(store.upsertAutoProfile).toHaveBeenCalledWith({
      agentId: 'demo-agent',
      name: 'Demo Agent',
      configJson: JSON.stringify({
        distributionType: 'npx',
        cmd: 'demo-agent-package',
        args: ['--stdio'],
      }),
    })
  })

  it('rejects startAgent when the agent is not installed', async () => {
    installed = makeInstalledAgent({ status: 'installing' })
    const service = createAcpApplicationService({
      registry: {
        fetchRegistry: vi.fn(async () => [registryAgent]),
        getSupportedDistributionTypes: vi.fn(() => ['binary', 'npx'] as AcpDistributionType[]),
      },
      store: store as AcpStore,
      installer: {
        installBinaryAgent: vi.fn(),
        installPackageAgent: vi.fn(),
        uninstallBinaryAgent: vi.fn(async () => {}),
      },
      runtime: runtime as AcpRuntimeController,
      paths: {
        getUserDataPath: vi.fn(() => '/tmp/user-data'),
        getAgentInstallPath: vi.fn((agentId: string) => `/tmp/user-data/acp/agents/${agentId}`),
      },
    })

    await expect(service.startAgent('demo-agent')).rejects.toThrow(/not ready/i)
    expect(runtime.startAgent).not.toHaveBeenCalled()
  })

  it('uninstalls binary ACP agents and removes the auto-created profile', async () => {
    installed = makeInstalledAgent({
      distributionType: 'binary',
      installPath: '/tmp/user-data/acp/agents/demo-agent',
      cmd: 'bin/demo-agent',
    })
    const uninstallBinaryAgent = vi.fn(async () => {})
    const service = createAcpApplicationService({
      registry: {
        fetchRegistry: vi.fn(async () => [registryAgent]),
        getSupportedDistributionTypes: vi.fn(() => ['binary', 'npx'] as AcpDistributionType[]),
      },
      store: store as AcpStore,
      installer: {
        installBinaryAgent: vi.fn(),
        installPackageAgent: vi.fn(),
        uninstallBinaryAgent,
      },
      runtime: runtime as AcpRuntimeController,
      paths: {
        getUserDataPath: vi.fn(() => '/tmp/user-data'),
        getAgentInstallPath: vi.fn((agentId: string) => `/tmp/user-data/acp/agents/${agentId}`),
      },
    })

    await service.uninstall('demo-agent')

    expect(uninstallBinaryAgent).toHaveBeenCalledWith('demo-agent', '/tmp/user-data/acp/agents/demo-agent', '/tmp/user-data')
    expect(store.deleteInstalled).toHaveBeenCalledWith('demo-agent')
    expect(store.deleteAutoProfile).toHaveBeenCalledWith('demo-agent')
  })
})