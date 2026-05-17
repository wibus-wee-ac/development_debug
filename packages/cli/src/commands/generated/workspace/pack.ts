// Input: generated OpenAPI CLI operation metadata
// Output: workspace pack command registration
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
    'pack',
  ],
  description: 'Pack codebase',
  flags: [
    {
      name: 'style',
      required: true,
      target: 'body.style',
      type: 'string',
      values: [
        'xml',
        'markdown',
        'plain',
      ],
    },
    {
      name: 'compress',
      required: true,
      target: 'body.compress',
      type: 'boolean',
    },
    {
      name: 'include',
      required: false,
      target: 'body.include',
      type: 'string',
    },
    {
      name: 'ignore',
      required: false,
      target: 'body.ignore',
      type: 'string',
    },
    {
      name: 'removeComments',
      required: false,
      target: 'body.removeComments',
      type: 'boolean',
    },
    {
      name: 'removeEmptyLines',
      required: false,
      target: 'body.removeEmptyLines',
      type: 'boolean',
    },
  ],
  method: 'post',
  path: '/workspaces/{id}/pack',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
