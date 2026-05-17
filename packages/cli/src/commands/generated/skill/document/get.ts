// Input: generated OpenAPI CLI operation metadata
// Output: skill document get command registration
// Position: packages/cli generated command module

import type { Command } from 'commander'

import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'

const spec = {
  arguments: [],
  command: [
    'skill',
    'document',
    'get',
  ],
  description: 'Get skill document',
  flags: [
    {
      name: 'scope',
      required: true,
      target: 'query.scope',
      type: 'string',
      values: [
        'builtin',
        'legacy',
        'global',
        'workspace',
        'agent',
      ],
    },
    {
      name: 'name',
      required: true,
      target: 'query.name',
      type: 'string',
    },
    {
      name: 'workspaceId',
      required: false,
      target: 'query.workspaceId',
      type: 'string',
    },
    {
      name: 'agentId',
      required: false,
      target: 'query.agentId',
      type: 'string',
    },
  ],
  method: 'get',
  path: '/skills/document',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
