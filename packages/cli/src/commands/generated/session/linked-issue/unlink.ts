// Input: generated OpenAPI CLI operation metadata
// Output: session linked-issue unlink command registration
// Position: packages/cli generated command module

import type { Command } from 'commander'

import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'

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
    'linked-issue',
    'unlink',
  ],
  description: 'Unlink issue from session',
  flags: [],
  method: 'delete',
  path: '/sessions/{id}/linked-issue',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
