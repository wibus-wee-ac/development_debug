// Input: generated OpenAPI CLI operation metadata
// Output: milestone delete command registration
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
    'milestone',
    'delete',
  ],
  description: 'Delete milestone',
  flags: [],
  method: 'delete',
  path: '/kanban/milestones/{id}',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
