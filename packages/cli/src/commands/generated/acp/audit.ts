// Input: generated OpenAPI CLI operation metadata
// Output: acp audit command registration
// Position: packages/cli generated command module

import type { Command } from 'commander'

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'

const spec = {
  arguments: [],
  command: [
    'acp',
    'audit',
  ],
  description: 'Get ACP audit log',
  flags: [
    {
      name: 'agentId',
      required: false,
      target: 'query.agentId',
      type: 'string',
    },
  ],
  method: 'get',
  path: '/acp/audit',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
