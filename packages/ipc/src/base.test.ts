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
    expect((services.test as TestService).ping()).toBe('injected-value')
  })
})
