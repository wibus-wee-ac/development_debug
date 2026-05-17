// Input: generated OpenAPI CLI operation metadata
// Output: milestone list command registration
// Position: packages/cli generated command module

import type { Command } from 'commander'

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'

const spec = {
  arguments: [],
  command: [
    'milestone',
    'list',
  ],
  description: 'List milestones',
  flags: [
    {
      name: 'workspaceId',
      required: true,
      target: 'query.workspaceId',
      type: 'string',
    },
  ],
  method: 'get',
  path: '/kanban/milestones',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
