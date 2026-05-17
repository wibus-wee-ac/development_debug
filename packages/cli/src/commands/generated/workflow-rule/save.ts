// Input: generated OpenAPI CLI operation metadata
// Output: workflow-rule save command registration
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
    'save',
  ],
  description: 'Save workflow rule',
  flags: [
    {
      name: 'agentProfileId',
      required: false,
      target: 'body.agentProfileId',
      type: 'string',
    },
    {
      name: 'content',
      required: true,
      target: 'body.content',
      type: 'string',
    },
  ],
  method: 'put',
  path: '/workflow-rules/{workspaceId}',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
