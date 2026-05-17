// Input: generated OpenAPI CLI operation metadata
// Output: agent list command registration
// Position: packages/cli generated command module

import type { Command } from 'commander'

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'

const spec = {
  arguments: [],
  command: [
    'agent',
    'list',
  ],
  description: 'List agents',
  flags: [
    {
      name: 'enabled',
      required: false,
      target: 'query.enabled',
      type: 'string',
    },
    {
      name: 'agentProfileId',
      required: false,
      target: 'query.agentProfileId',
      type: 'string',
    },
  ],
  method: 'get',
  path: '/agents/',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
