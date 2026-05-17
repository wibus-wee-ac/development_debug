// Input: generated OpenAPI CLI operation metadata
// Output: skill document update command registration
// Position: packages/cli generated command module

import type { Command } from 'commander'

import { registerOperationCommand } from '../../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../../runtime/types'

const spec = {
  arguments: [],
  command: [
    'skill',
    'document',
    'update',
  ],
  description: 'Update skill document',
  flags: [
    {
      name: 'scope',
      required: true,
      target: 'body.scope',
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
      target: 'body.name',
      type: 'string',
    },
    {
      name: 'workspaceId',
      required: false,
      target: 'body.workspaceId',
      type: 'string',
    },
    {
      name: 'agentId',
      required: false,
      target: 'body.agentId',
      type: 'string',
    },
    {
      name: 'document',
      required: true,
      target: 'body.document',
      type: 'json',
    },
  ],
  method: 'put',
  path: '/skills/document',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
