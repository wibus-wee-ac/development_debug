// Input: generated OpenAPI CLI operation metadata
// Output: session messages command registration
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
    'messages',
  ],
  description: 'Get session messages',
  flags: [],
  method: 'get',
  path: '/sessions/{id}/messages',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
