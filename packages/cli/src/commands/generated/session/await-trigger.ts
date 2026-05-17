// Input: generated OpenAPI CLI operation metadata
// Output: session await-trigger command registration
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
    'await-trigger',
  ],
  description: 'Manually trigger a session await',
  flags: [
    {
      name: 'resumeText',
      required: true,
      target: 'body.resumeText',
      type: 'string',
    },
    {
      name: 'resumePayloadJson',
      required: false,
      target: 'body.resumePayloadJson',
      type: 'string',
    },
  ],
  method: 'post',
  path: '/session-awaits/{id}/trigger',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
