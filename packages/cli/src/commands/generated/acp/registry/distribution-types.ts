// Input: generated OpenAPI CLI operation metadata
// Output: acp registry distribution-types command registration
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
    'registry',
    'distribution-types',
  ],
  description: 'Get distribution types for a registry agent',
  flags: [],
  method: 'get',
  path: '/acp/registry/{agentId}/distribution-types',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
