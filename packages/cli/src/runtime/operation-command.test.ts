import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { registerOperationCommand } from './operation-command'
import type { CommandContext } from './types'

function createProgram(context: CommandContext): Command {
  return new Command()
    .exitOverride()
    .option('--server <url>', 'Cradle server URL', context.serverUrl)
    .hook('preAction', (root) => {
      root.setOptionValue('__context', context)
    })
}

describe('registerOperationCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('preserves true, false, and omitted boolean flags', async () => {
    const run = async (argv: string[]) => {
      const request = vi.fn().mockResolvedValue({ ok: true })
      const program = createProgram({ serverUrl: 'http://localhost:21423', request })

      registerOperationCommand(program, {
        command: ['automation', 'list'],
        flags: [{ name: 'enabled', target: 'query.enabled', type: 'boolean' }],
        method: 'get',
        path: '/automations',
      })

      await program.parseAsync(argv, { from: 'user' })
      return request
    }

    await expect(run(['automation', 'list', '--enabled'])).resolves.toHaveBeenCalledWith(expect.objectContaining({
      query: { enabled: true },
    }))
    await expect(run(['automation', 'list', '--no-enabled'])).resolves.toHaveBeenCalledWith(expect.objectContaining({
      query: { enabled: false },
    }))
    await expect(run(['automation', 'list'])).resolves.toHaveBeenCalledWith(expect.objectContaining({
      query: {},
    }))
  })

  it('parses required boolean values strictly', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true })
    const program = createProgram({ serverUrl: 'http://localhost:21423', request })

    registerOperationCommand(program, {
      command: ['feature', 'set'],
      flags: [{ name: 'enabled', required: true, target: 'body.enabled', type: 'boolean' }],
      method: 'put',
      path: '/feature',
    })

    await program.parseAsync(['feature', 'set', '--enabled', 'false'], { from: 'user' })

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      body: { enabled: false },
    }))
    await expect(program.parseAsync(['feature', 'set', '--enabled', 'nope'], { from: 'user' }))
      .rejects.toThrow('Expected a boolean')
  })
})
