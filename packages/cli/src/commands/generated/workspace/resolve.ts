// Input: generated OpenAPI CLI operation metadata
// Output: workspace resolve command registration
// Position: packages/cli generated command module

import type { Command } from 'commander'

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'

const spec = {
  arguments: [],
  command: [
    'workspace',
    'resolve',
  ],
  description: 'Resolve workspace by path',
  flags: [
    {
      name: 'path',
      required: true,
      target: 'query.path',
      type: 'string',
    },
  ],
  method: 'get',
  path: '/workspaces/resolve',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
