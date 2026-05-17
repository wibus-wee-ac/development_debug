// Input: generated OpenAPI CLI operation metadata
// Output: status update command registration
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
    'status',
    'update',
  ],
  description: 'Update status',
  flags: [
    {
      name: 'name',
      required: false,
      target: 'body.name',
      type: 'string',
    },
    {
      name: 'color',
      required: false,
      target: 'body.color',
      type: 'string',
    },
  ],
  method: 'patch',
  path: '/kanban/statuses/{id}',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
