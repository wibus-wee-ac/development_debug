// Input: generated OpenAPI CLI operation metadata
// Output: workspace update command registration
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
    'workspace',
    'update',
  ],
  description: 'Update workspace',
  flags: [
    {
      name: 'name',
      required: true,
      target: 'body.name',
      type: 'string',
    },
  ],
  method: 'patch',
  path: '/workspaces/{id}',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
