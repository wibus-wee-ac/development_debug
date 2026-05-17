// Input: generated OpenAPI CLI operation metadata
// Output: board list command registration
// Position: packages/cli generated command module

import type { Command } from 'commander'

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'

const spec = {
  arguments: [],
  command: [
    'board',
    'list',
  ],
  description: 'List boards',
  flags: [
    {
      name: 'workspaceId',
      required: false,
      target: 'query.workspaceId',
      type: 'string',
    },
  ],
  method: 'get',
  path: '/kanban/boards',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
