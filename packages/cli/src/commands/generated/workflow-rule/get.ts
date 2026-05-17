// Input: generated OpenAPI CLI operation metadata
// Output: workflow-rule get command registration
// Position: packages/cli generated command module

import type { Command } from 'commander'

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'

const spec = {
  arguments: [
    {
      name: 'workspaceId',
      required: true,
      target: 'path.workspaceId',
      type: 'string',
    },
  ],
  command: [
    'workflow-rule',
    'get',
  ],
  description: 'Get workflow rules',
  flags: [
    {
      name: 'agentProfileId',
      required: false,
      target: 'query.agentProfileId',
      type: 'string',
    },
  ],
  method: 'get',
  path: '/workflow-rules/{workspaceId}',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
