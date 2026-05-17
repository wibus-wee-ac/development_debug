// Input: generated OpenAPI CLI operation metadata
// Output: session await-cancel command registration
// Position: packages/cli generated command module

import type { Command } from 'commander'

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'

const spec = {
  arguments: [
    {
      name: 'id',
      required: true,
      target: 'path.id',
      type: 'string',
    },
  ],
  command: [
    'session',
    'await-cancel',
  ],
  description: 'Cancel a pending session await',
  flags: [],
  method: 'post',
  path: '/session-awaits/{id}/cancel',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
