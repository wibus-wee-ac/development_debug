// Input: Mocked Electron ipcMain plus IpcService/createServices from the shared IPC package
// Output: Unit test proving createServices accepts pre-built service instances for explicit composition-root injection
// Position: Package-level regression guard for instance-based IPC wiring support

import { describe, expect, it, vi } from 'vitest'

import { createServices, IpcMethod, IpcService } from './base'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}))

class TestService extends IpcService {
  static readonly groupName = 'test'

  constructor(private readonly value: string) {
    super()
  }

  @IpcMethod()
  ping() {
    return this.value
  }
}

describe('createServices', () => {
  it('accepts pre-built service instances for explicit dependency injection', () => {
    const service = new TestService('injected-value')

    const services = createServices([service] as const)

    expect(services.test).toBe(service)
    expect(services.test.ping()).toBe('injected-value')
  })
})
