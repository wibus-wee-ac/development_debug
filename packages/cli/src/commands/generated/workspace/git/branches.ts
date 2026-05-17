// Input: generated OpenAPI CLI operation metadata
// Output: workspace git branches command registration
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
    'branches',
  ],
  description: 'Get git branches',
  flags: [],
  method: 'get',
  path: '/workspaces/{id}/git/branches',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
