// Input: generated OpenAPI CLI operation metadata
// Output: session linked-issue get command registration
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
    'get',
  ],
  description: 'Get linked issue',
  flags: [],
  method: 'get',
  path: '/sessions/{id}/linked-issue',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
