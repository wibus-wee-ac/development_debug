// Input: generated OpenAPI CLI operation metadata
// Output: acp agent install-path command registration
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
    'install-path',
  ],
  description: 'Get agent install path',
  flags: [],
  method: 'get',
  path: '/acp/agents/{agentId}/install-path',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
