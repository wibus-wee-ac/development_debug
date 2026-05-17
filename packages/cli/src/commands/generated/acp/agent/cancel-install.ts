// Input: generated OpenAPI CLI operation metadata
// Output: acp agent cancel-install command registration
// Position: packages/cli generated command module

import type { Command } from 'commander'

import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'

const spec = {
  arguments: [
    {
      name: 'agentId',
      required: true,
      target: 'path.agentId',
      type: 'string',
    },
  ],
  command: [
    'acp',
    'agent',
    'cancel-install',
  ],
  description: 'Cancel agent installation',
  flags: [],
  method: 'delete',
  path: '/acp/agents/{agentId}/installation',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
