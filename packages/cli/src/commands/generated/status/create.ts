// Input: generated OpenAPI CLI operation metadata
// Output: status create command registration
// Position: packages/cli generated command module

import type { Command } from 'commander'

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'

const spec = {
  arguments: [],
  command: [
    'status',
    'create',
  ],
  description: 'Create status',
  flags: [
    {
      name: 'workspaceId',
      required: true,
      target: 'body.workspaceId',
      type: 'string',
    },
    {
      name: 'name',
      required: true,
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
  method: 'post',
  path: '/kanban/statuses',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
