// Input: generated OpenAPI CLI operation metadata
// Output: acp agent uninstall command registration
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
    'uninstall',
  ],
  description: 'Uninstall an agent',
  flags: [],
  method: 'delete',
  path: '/acp/agents/{agentId}',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
