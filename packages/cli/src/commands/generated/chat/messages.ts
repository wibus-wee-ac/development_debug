// Input: generated OpenAPI CLI operation metadata
// Output: chat messages command registration
// Position: packages/cli generated command module

import type { Command } from 'commander'

import { registerOperationCommand } from '../../../runtime/operation-command'
import type { CliOperationSpec } from '../../../runtime/types'

const spec = {
  arguments: [
    {
      name: 'sessionId',
      required: true,
      target: 'path.sessionId',
      type: 'string',
    },
  ],
  command: [
    'chat',
    'messages',
  ],
  description: 'Get chat message groups',
  flags: [],
  method: 'get',
  path: '/chat/sessions/{sessionId}/messages',
} satisfies CliOperationSpec

export function register(program: Command): void {
  registerOperationCommand(program, spec)
}
