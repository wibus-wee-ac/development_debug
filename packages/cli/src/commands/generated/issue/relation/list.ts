// Input: generated OpenAPI CLI operation metadata
// Output: issue relation list command registration
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
    'issue',
    'relation',
    'list',
  ],
  description: 'List issue relations',
  flags: [],
  method: 'get',
  path: '/kanban/issues/{id}/relations',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
