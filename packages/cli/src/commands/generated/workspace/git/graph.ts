// Input: generated OpenAPI CLI operation metadata
// Output: workspace git graph command registration
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
    'workspace',
    'git',
    'graph',
  ],
  description: 'Get git graph',
  flags: [
    {
      name: 'limit',
      required: false,
      target: 'query.limit',
      type: 'string',
    },
  ],
  method: 'get',
  path: '/workspaces/{id}/git/graph',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
