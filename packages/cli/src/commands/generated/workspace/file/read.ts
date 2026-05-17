// Input: generated OpenAPI CLI operation metadata
// Output: workspace file read command registration
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
    'file',
    'read',
  ],
  description: 'Read workspace file content',
  flags: [
    {
      name: 'path',
      required: true,
      target: 'query.path',
      type: 'string',
    },
  ],
  method: 'get',
  path: '/workspaces/{id}/files/content',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
