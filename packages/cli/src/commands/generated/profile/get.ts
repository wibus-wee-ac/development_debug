// Input: generated OpenAPI CLI operation metadata
// Output: profile get command registration
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
    'profile',
    'get',
  ],
  description: 'Get profile by ID',
  flags: [],
  method: 'get',
  path: '/profiles/{id}',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
