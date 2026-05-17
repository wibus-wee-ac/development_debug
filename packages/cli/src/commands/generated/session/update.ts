// Input: generated OpenAPI CLI operation metadata
// Output: session update command registration
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
    'session',
    'update',
  ],
  description: 'Update session',
  flags: [
    {
      name: 'title',
      required: false,
      target: 'body.title',
      type: 'string',
    },
    {
      name: 'pinned',
      required: false,
      target: 'body.pinned',
      type: 'boolean',
    },
  ],
  method: 'patch',
  path: '/sessions/{id}',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
