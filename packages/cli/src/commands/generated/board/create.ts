// Input: generated OpenAPI CLI operation metadata
// Output: board create command registration
// Position: packages/cli generated command module

import type { Command } from 'commander'

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'

const spec = {
  arguments: [],
  command: [
    'board',
    'create',
  ],
  description: 'Create board',
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
      name: 'filterConfig',
      required: false,
      target: 'body.filterConfig',
      type: 'string',
    },
  ],
  method: 'post',
  path: '/kanban/boards',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
