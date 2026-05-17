// Input: generated OpenAPI CLI operation metadata
// Output: profile set command registration
// Position: packages/cli generated command module

import type { Command } from 'commander'

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'

const spec = {
  arguments: [
    {
      name: 'id',
      required: true,
      target: 'path.id',
      type: 'string',
    },
  ],
  command: [
    'profile',
    'set',
  ],
  description: 'Create or update profile',
  flags: [
    {
      name: 'name',
      required: true,
      target: 'body.name',
      type: 'string',
    },
    {
      name: 'providerKind',
      required: true,
      target: 'body.providerKind',
      type: 'string',
      values: [
        'openai-compatible',
        'codex',
        'claude-agent',
        'acp-chat',
        'cli-tui',
      ],
    },
    {
      name: 'enabled',
      required: true,
      target: 'body.enabled',
      type: 'boolean',
    },
    {
      name: 'config',
      required: true,
      target: 'body.config',
      type: 'json',
    },
    {
      name: 'credentialRef',
      required: false,
      target: 'body.credentialRef',
      type: 'string',
    },
  ],
  method: 'put',
  path: '/profiles/{id}',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
